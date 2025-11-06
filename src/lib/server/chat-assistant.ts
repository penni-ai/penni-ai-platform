import { env } from '$env/dynamic/private';
import {
	conversationCollectionRef,
	conversationDocRef,
	conversationMessagesCollectionRef,
	serverTimestamp,
	firestore,
	campaignDocRef,
	siteDocRef
} from '$lib/server/firestore';

const REQUIRED_FIELDS = ['website', 'audience', 'locations', 'followers'] as const;

type RequiredField = (typeof REQUIRED_FIELDS)[number];

type ConversationStatus =
  | 'collecting'
  | 'ready'
  | 'searching'
  | 'complete'
  | 'needs_config'
  | 'error';

type MessageRole = 'assistant' | 'user';

export type ConversationMessage = {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  type?: 'intro' | 'text' | 'summary';
};

export type ConversationSnapshot = {
  id: string;
  status: ConversationStatus;
  collected: Partial<Record<RequiredField, string>>;
  missing: RequiredField[];
  search?: {
    status: 'idle' | 'pending' | 'complete' | 'error' | 'needs_config';
    results?: unknown;
    lastError?: string | null;
    completedAt?: string | null;
  };
  messages: ConversationMessage[];
};

type AssistantModelResponse = {
  reply: string;
  collected?: Record<string, string | null>;
  needs?: RequiredField[];
  search_ready?: boolean;
};

const INTRO_MESSAGE =
	"Welcome to Penny AI Influencer Search! I'm here to help you find influencers for your business or event~ Tell me what kind of influencers you're looking for! Sending your business website if you have one would be helpful as well.";
const FIRST_PROMPT = "To get started, what's your business website or landing page?";

const SYSTEM_PROMPT = `You are Dime, a friendly but efficient marketing assistant that helps brand managers define influencer campaigns. Speak in a warm conversational tone, but always keep an accurate internal record of the user's answers.

Behaviour guidelines:
- After each user turn, output the JSON response defined in the schema. Update collected.website, collected.audience, collected.locations, and collected.followers with the literal phrases the user provides (e.g. "remote is fine", "20k-150k followers"). Use null only when the value is truly unknown.
- Never ask for a field that already has a value. Politely acknowledge information the user already gave (“Great—remote TikTok creators around 20k-150k followers”).
- When site context is available, begin the first reply with a friendly one- or two-sentence summary of the business before asking for missing fields.
- Ask at most one clarifying question per turn, only for slots that remain empty.
- Once all required fields are filled, respond with a brief confirmation and do not ask additional questions—wait for the system to finalize the campaign.
- Always keep your public reply concise (1-2 short paragraphs) and match the user's tone.

If a value is unknown, leave it null in the JSON.`;

const JSON_SCHEMA = {
  name: 'penny_chat_response',
  schema: {
    type: 'object',
    properties: {
      reply: { type: 'string' },
      collected: {
        type: 'object',
        properties: REQUIRED_FIELDS.reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = { type: ['string', 'null'] };
          return acc;
        }, {}),
        additionalProperties: {
          type: ['string', 'null']
        }
      },
      needs: {
        type: 'array',
        items: { enum: REQUIRED_FIELDS }
      },
      search_ready: { type: 'boolean' }
    },
    required: ['reply']
  }
};

const DEFAULT_MODEL = 'gpt-4o-mini';
const MAX_SITE_CONTEXT_CHARS = 6000;

export async function createConversation(uid: string): Promise<ConversationSnapshot> {
  const collectionRef = conversationCollectionRef(uid);
  const docRef = collectionRef.doc();
  const now = Date.now();

  const snapshotData = {
    createdAt: serverTimestamp(),
    createdAtMs: now,
    updatedAt: serverTimestamp(),
    updatedAtMs: now,
    status: 'collecting' as ConversationStatus,
    requiredFields: Array.from(REQUIRED_FIELDS),
    collected: {},
    missing: Array.from(REQUIRED_FIELDS),
    search: {
      status: 'idle' as const,
      results: null,
      lastError: null,
      completedAt: null
    }
  };

  await docRef.set(snapshotData);

  const messagesRef = conversationMessagesCollectionRef(uid, docRef.id);

  const introMessage = {
    id: messagesRef.doc().id,
    role: 'assistant' as MessageRole,
    content: INTRO_MESSAGE,
    type: 'intro' as const,
    createdAt: now
  };

  await messagesRef.doc(introMessage.id).set({
    role: introMessage.role,
    content: introMessage.content,
    type: introMessage.type,
    createdAt: serverTimestamp(),
    createdAtMs: now
  });

  const firstPromptMessage = {
    id: messagesRef.doc().id,
    role: 'assistant' as MessageRole,
    content: FIRST_PROMPT,
    type: 'text' as const,
    createdAt: now + 1
  };

  await messagesRef.doc(firstPromptMessage.id).set({
    role: firstPromptMessage.role,
    content: firstPromptMessage.content,
    type: firstPromptMessage.type,
    createdAt: serverTimestamp(),
    createdAtMs: now + 1
  });

  return {
    id: docRef.id,
    status: 'collecting',
    collected: {},
    missing: Array.from(REQUIRED_FIELDS),
    search: {
      status: 'idle'
    },
    messages: [
      {
        ...introMessage,
        createdAt: new Date(introMessage.createdAt).toISOString()
      },
      {
        ...firstPromptMessage,
        createdAt: new Date(firstPromptMessage.createdAt).toISOString()
      }
    ]
  };
}

export async function getConversation(uid: string, conversationId: string): Promise<ConversationSnapshot | null> {
  const docRef = conversationDocRef(uid, conversationId);
  const doc = await docRef.get();
  if (!doc.exists) {
    return null;
  }

  const data = doc.data() as Record<string, any>;
  const messagesSnap = await conversationMessagesCollectionRef(uid, conversationId)
    .orderBy('createdAtMs', 'asc')
    .get();

  const messages: ConversationMessage[] = messagesSnap.docs.map((messageDoc) => {
    const payload = messageDoc.data() as Record<string, any>;
    const createdAtMs = typeof payload.createdAtMs === 'number' ? payload.createdAtMs : Date.now();
    return {
      id: messageDoc.id,
      role: (payload.role as MessageRole) ?? 'assistant',
      content: String(payload.content ?? ''),
      type: payload.type,
      createdAt: new Date(createdAtMs).toISOString()
    };
  });

  return {
    id: conversationId,
    status: (data.status as ConversationStatus) ?? 'collecting',
    collected: (data.collected as Record<RequiredField, string | undefined>) ?? {},
    missing: (Array.isArray(data.missing) ? data.missing : REQUIRED_FIELDS) as RequiredField[],
    search: data.search ?? { status: 'idle' },
    messages
  };
}

export async function registerUserMessage(uid: string, conversationId: string, content: string) {
  const trimmed = content.trim();
  if (!trimmed) throw new Error('Message must not be empty');

  const messagesRef = conversationMessagesCollectionRef(uid, conversationId);
  const messageId = messagesRef.doc().id;
  const createdAtMs = Date.now();

  await messagesRef.doc(messageId).set({
    role: 'user',
    content: trimmed,
    type: 'text',
    createdAt: serverTimestamp(),
    createdAtMs
  });

  await conversationDocRef(uid, conversationId).set(
    {
      updatedAt: serverTimestamp(),
      updatedAtMs: createdAtMs
    },
    { merge: true }
  );

  return {
    id: messageId,
    role: 'user' as const,
    content: trimmed,
    type: 'text' as const,
    createdAt: new Date(createdAtMs).toISOString()
  } satisfies ConversationMessage;
}

export async function handleAssistantTurn(
	uid: string,
	conversationId: string,
	latestUserMessage?: string
): Promise<{
  assistantMessages: ConversationMessage[];
  snapshot: ConversationSnapshot;
}> {
  const messagesSnapshot = await conversationMessagesCollectionRef(uid, conversationId)
    .orderBy('createdAtMs', 'asc')
    .get();

  let history = messagesSnapshot.docs.map((doc) => {
    const payload = doc.data() as Record<string, any>;
    return {
      role: (payload.role as MessageRole) ?? 'assistant',
      content: String(payload.content ?? '')
    };
  });

  history = await prependSiteContext(uid, history, latestUserMessage ?? null);

  const aiResponse = await callAssistant(history);

  const assistantMessage = await persistAssistantMessage(uid, conversationId, aiResponse.reply);

  const snapshot = await updateConversationSnapshot(uid, conversationId, aiResponse);

  if (snapshot.status === 'ready' || snapshot.status === 'collecting') {
    return { assistantMessages: [assistantMessage], snapshot };
  }

  if (snapshot.status === 'needs_config' || snapshot.status === 'error') {
    return { assistantMessages: [assistantMessage], snapshot };
  }

  if (snapshot.status === 'searching') {
    const followUp = await maybeCreateCampaign(uid, conversationId, snapshot);
    if (followUp) {
      return {
        assistantMessages: [assistantMessage, ...followUp.messages],
        snapshot: followUp.snapshot
      };
    }
    return { assistantMessages: [assistantMessage], snapshot };
  }

  if (snapshot.status === 'complete') {
    return { assistantMessages: [assistantMessage], snapshot };
  }

  return { assistantMessages: [assistantMessage], snapshot };
}

async function persistAssistantMessage(uid: string, conversationId: string, content: string) {
  const messagesRef = conversationMessagesCollectionRef(uid, conversationId);
  const messageId = messagesRef.doc().id;
  const createdAtMs = Date.now();

  await messagesRef.doc(messageId).set({
    role: 'assistant',
    content,
    type: 'text',
    createdAt: serverTimestamp(),
    createdAtMs
  });

  await conversationDocRef(uid, conversationId).set(
    {
      updatedAt: serverTimestamp(),
      updatedAtMs: createdAtMs
    },
    { merge: true }
  );

  return {
    id: messageId,
    role: 'assistant' as const,
    content,
    type: 'text' as const,
    createdAt: new Date(createdAtMs).toISOString()
  } satisfies ConversationMessage;
}

async function callAssistant(history: Array<{ role: MessageRole; content: string }>): Promise<AssistantModelResponse> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      reply: 'I need an API key to continue this conversation. Please contact support.',
      needs: REQUIRED_FIELDS,
      search_ready: false
    };
  }

  const model = env.OPENAI_MODEL ?? DEFAULT_MODEL;

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map((item) => ({ role: item.role, content: item.content }))
  ];

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages,
      response_format: {
        type: 'json_schema',
        json_schema: JSON_SCHEMA
      }
    })
  });

  if (!response.ok) {
    const errorText = await safeReadText(response);
    console.error('[chat] OpenAI error', response.status, errorText);
    return {
      reply: `I hit a snag reaching our assistant (status ${response.status}). Mind trying again in a bit?`,
      needs: REQUIRED_FIELDS,
      search_ready: false
    };
  }

  const payload = (await response.json()) as any;
  const rawContent = payload?.choices?.[0]?.message?.content;
  if (typeof rawContent !== 'string') {
    return {
      reply: 'I could not understand the assistant response. Please try again.',
      needs: REQUIRED_FIELDS,
      search_ready: false
    };
  }

  try {
    const parsed = JSON.parse(rawContent) as AssistantModelResponse;
    return parsed;
  } catch (error) {
    console.warn('[chat] failed to parse assistant response', error);
    return {
      reply: rawContent,
      needs: REQUIRED_FIELDS,
      search_ready: false
    };
  }
}

async function safeReadText(response: Response) {
  try {
    return await response.text();
  } catch (error) {
    console.warn('[chat] failed to read response text', error);
    return 'unknown error';
  }
}

async function updateConversationSnapshot(
  uid: string,
  conversationId: string,
  aiResponse: AssistantModelResponse
): Promise<ConversationSnapshot> {
  const docRef = conversationDocRef(uid, conversationId);
  const docSnap = await docRef.get();
  if (!docSnap.exists) {
    throw new Error('Conversation not found');
  }

  const existing = docSnap.data() as Record<string, any>;
  const collected = { ...(existing.collected ?? {}) } as Record<RequiredField, string | undefined>;

  if (aiResponse.collected) {
    for (const key of Object.keys(aiResponse.collected)) {
      const typedKey = key as RequiredField;
      const value = aiResponse.collected[key];
      if (REQUIRED_FIELDS.includes(typedKey) && typeof value === 'string' && value.trim()) {
        collected[typedKey] = value.trim();
      }
    }
  }

  const missing = REQUIRED_FIELDS.filter((field) => !collected[field]);

  let status: ConversationStatus = 'collecting';
  if (missing.length === 0) {
    status = 'searching';
  }

  const search = existing.search ?? { status: 'idle' };

  await docRef.set(
    {
      collected,
      missing,
      status,
      search,
      updatedAt: serverTimestamp(),
      updatedAtMs: Date.now()
    },
    { merge: true }
  );

	const snapshot = await getConversation(uid, conversationId);
	if (!snapshot) {
		throw new Error('Conversation missing after update');
	}

	console.debug('[chat] collected fields', {
		uid,
		conversationId,
		collected,
		missing
	});

	return snapshot;
}

async function prependSiteContext(
	uid: string,
	history: Array<{ role: MessageRole; content: string }>,
	latestUserMessage: string | null
): Promise<Array<{ role: MessageRole; content: string }>> {
	try {
		const snapshot = await firestore
			.collection(`users/${uid}/sites`)
			.orderBy('capturedAt', 'desc')
			.limit(1)
			.get();

		const doc = snapshot.docs[0];
		if (!doc) return history;

		const data = doc.data() as { rawText?: string; url?: string; capturedAt?: number };
		if (!data?.rawText) return history;

		const snippet = data.rawText.slice(0, MAX_SITE_CONTEXT_CHARS);
		const capturedAt = data.capturedAt ? new Date(data.capturedAt).toISOString() : 'unknown date';
		const siteUrl = data.url ?? 'the provided website';
		const systemContent = `Business profile extracted from ${siteUrl} (captured ${capturedAt}). Use this information to first provide the user with a concise summary (one or two sentences) of the business in your next reply, clearly acknowledging the website you reviewed. Ask at most one follow-up question about whichever of these fields remain unknown: website, audience, locations, followers. Do not re-ask for any information that already exists in collected data. Latest user message pattern to consider: ${latestUserMessage ?? 'n/a'}.\n\n${snippet}`;

		return [{ role: 'system', content: systemContent }, ...history];
	} catch (error) {
		console.warn('[chat] failed to load site context', error);
		return history;
	}
}

async function maybeCreateCampaign(
	uid: string,
	conversationId: string,
	snapshot: ConversationSnapshot
): Promise<{ messages: ConversationMessage[]; snapshot: ConversationSnapshot } | null> {
	const collected = snapshot.collected;
	const docRef = campaignDocRef(uid, conversationId);
	const existing = await docRef.get();

	if (!existing.exists) {
		const siteSnap = await firestore
			.collection(`users/${uid}/sites`)
			.orderBy('capturedAt', 'desc')
			.limit(1)
			.get();

		const siteData = siteSnap.docs[0]?.data() as { rawText?: string; url?: string } | undefined;
		const businessSummary = siteData?.rawText
			? siteData.rawText.slice(0, 600)
			: collected.website
				? `Business website: ${collected.website}`
				: 'Business summary not provided yet.';

		await docRef.set({
			id: conversationId,
			createdAt: Date.now(),
			website: collected.website ?? null,
			audience: collected.audience ?? null,
			locations: collected.locations ?? null,
			followers: collected.followers ?? null,
			businessSummary,
			sourceConversationId: conversationId
		});
	}

	await conversationDocRef(uid, conversationId).set(
		{
			status: 'complete',
			search: {
				status: 'complete',
				results: null,
				lastError: null,
				completedAt: new Date().toISOString()
			}
		},
		{ merge: true }
	);

	const baseUrl = env.PUBLIC_SITE_URL?.replace(/\/$/, '') ?? '';
	const campaignUrl = baseUrl ? `${baseUrl}/campaign/chat/${conversationId}` : `/campaign/chat/${conversationId}`;
	const assistantMessage = await persistAssistantMessage(
		uid,
		conversationId,
		`Cool! That's all I'll need for now. I'll create a campaign here (show embedded preview to the campaign page), please navigate here and I've initiated the search for influencers! Keep watch here for influencers as my systems find them~ ${campaignUrl}`
	);

	const refreshed = await getConversation(uid, conversationId);
	if (!refreshed) throw new Error('Conversation missing after campaign creation');
	return { messages: [assistantMessage], snapshot: refreshed };
}
