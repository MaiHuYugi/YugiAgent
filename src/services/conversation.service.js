import { Conversation } from '../models/conversation.model.js';
import { decryptText, encryptText } from './encryption.service.js';

const MAX_STORED_MESSAGES = 200;
const MODEL_CONTEXT_MESSAGES = 40;

export async function listUserConversations(ownerId) {
  const conversations = await Conversation.find({ owner: ownerId }).sort({ updatedAt: -1 }).limit(50);
  return conversations.map((conversation) => ({
    id: String(conversation._id),
    title: decryptText(conversation.title),
    updatedAt: conversation.updatedAt
  }));
}

export async function getUserConversation(ownerId, conversationId) {
  const conversation = await Conversation.findOne({ _id: conversationId, owner: ownerId });
  if (!conversation) return null;

  return {
    id: String(conversation._id),
    title: decryptText(conversation.title),
    updatedAt: conversation.updatedAt,
    messages: conversation.messages.map((message) => ({
      role: message.role,
      content: decryptText(message.content),
      createdAt: message.createdAt
    }))
  };
}

export async function deleteUserConversation(ownerId, conversationId) {
  const result = await Conversation.deleteOne({ _id: conversationId, owner: ownerId });
  return result.deletedCount > 0;
}

export async function deleteAllUserConversations(ownerId) {
  await Conversation.deleteMany({ owner: ownerId });
}

export async function startConversationTurn(ownerId, conversationId, messageText) {
  let conversation;
  if (conversationId) {
    conversation = await Conversation.findOne({ _id: conversationId, owner: ownerId });
    if (!conversation) return null;
  } else {
    conversation = new Conversation({
      owner: ownerId,
      title: encryptText(messageText.slice(0, 100)),
      messages: []
    });
  }

  let pendingAction = null;
  let pendingActionExpired = false;
  if (conversation.pendingAction) {
    try {
      pendingAction = JSON.parse(decryptText(conversation.pendingAction));
      if (!pendingAction.expiresAt || Date.parse(pendingAction.expiresAt) <= Date.now()) {
        pendingAction = null;
        conversation.pendingAction = null;
        pendingActionExpired = true;
      }
    } catch {
      pendingAction = null;
      conversation.pendingAction = null;
      pendingActionExpired = true;
    }
  }
  let pendingPlanner = null;
  let pendingPlannerExpired = false;
  if (conversation.pendingPlanner) {
    try {
      pendingPlanner = JSON.parse(decryptText(conversation.pendingPlanner));
      const expiresAt = Date.parse(pendingPlanner.expiresAt);
      if (!pendingPlanner.sessionId || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        pendingPlanner = null;
        conversation.pendingPlanner = null;
        pendingPlannerExpired = true;
      }
    } catch {
      pendingPlanner = null;
      conversation.pendingPlanner = null;
      pendingPlannerExpired = true;
    }
  }
  let pendingWorkflow = null;
  let pendingWorkflowExpired = false;
  if (conversation.pendingWorkflow) {
    try {
      pendingWorkflow = JSON.parse(decryptText(conversation.pendingWorkflow));
      const expiresAt = Date.parse(pendingWorkflow.expiresAt);
      if (!pendingWorkflow.type || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        pendingWorkflow = null;
        conversation.pendingWorkflow = null;
        pendingWorkflowExpired = true;
      }
    } catch {
      pendingWorkflow = null;
      conversation.pendingWorkflow = null;
      pendingWorkflowExpired = true;
    }
  }
  conversation.messages.push({ role: 'user', content: encryptText(messageText) });
  trimMessages(conversation);
  conversation.updatedAt = new Date();
  await conversation.save();

  const modelMessages = conversation.messages.slice(-MODEL_CONTEXT_MESSAGES).map((item) => ({
    role: item.role,
    content: decryptText(item.content).replaceAll('*', '')
  }));
  return { conversation, modelMessages, pendingAction, pendingActionExpired, pendingPlanner, pendingPlannerExpired, pendingWorkflow, pendingWorkflowExpired };
}

export async function saveAssistantReply(conversation, text, pendingAction = undefined, pendingPlanner = undefined, pendingWorkflow = undefined) {
  if (text) conversation.messages.push({ role: 'assistant', content: encryptText(text) });
  if (pendingAction !== undefined) conversation.pendingAction = pendingAction ? encryptText(JSON.stringify(pendingAction)) : null;
  if (pendingPlanner !== undefined) conversation.pendingPlanner = pendingPlanner ? encryptText(JSON.stringify(pendingPlanner)) : null;
  if (pendingWorkflow !== undefined) conversation.pendingWorkflow = pendingWorkflow ? encryptText(JSON.stringify(pendingWorkflow)) : null;
  trimMessages(conversation);
  conversation.updatedAt = new Date();
  await conversation.save();
}

export async function savePendingPlannerSession(conversation, pendingPlanner) {
  conversation.pendingPlanner = encryptText(JSON.stringify(pendingPlanner));
  conversation.updatedAt = new Date();
  await conversation.save();
}

export async function clearPendingAction(conversation) {
  if (!conversation.pendingAction) return;
  conversation.pendingAction = null;
  conversation.updatedAt = new Date();
  await conversation.save();
}

function trimMessages(conversation) {
  if (conversation.messages.length > MAX_STORED_MESSAGES) {
    conversation.messages.splice(0, conversation.messages.length - MAX_STORED_MESSAGES);
  }
}
