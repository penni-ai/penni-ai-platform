export type ContactMethod = 'email' | 'instagram' | 'tiktok';
export type Stage = 'select-methods' | 'draft-messages' | 'review-info' | 'review';

export interface Influencer {
	_id?: string;
	display_name?: string;
	platform?: string;
	email_address?: string;
	business_email?: string;
	profile_url?: string;
	biography?: string;
	bio?: string;
}

export interface GmailConnection {
	id: string;
	email: string;
	primary: boolean;
	connectedAt: number | null;
	lastRefreshedAt: number | null;
	accountType?: 'draft' | 'send';
}

export interface ReviewRecipient {
	influencer: Influencer;
	methods: ContactMethod[];
	messages: Record<ContactMethod, string>;
	emailAccountId?: string | null;
}

export interface SendOutreachSequenceProps {
	currentStage: Stage;
	selectedMethods: Map<string, Set<ContactMethod>>;
	messageContents: Record<ContactMethod, string>;
	editingPlatform: ContactMethod | null;
	navigationValidationErrors: Record<ContactMethod, string[]>;
	gmailConnections: GmailConnection[];
	selectedEmailAccounts: Map<string, string>;
	reviewData: ReviewRecipient[];
	reviewCounts: { email: number; instagram: number; tiktok: number };
	currentStageIndex: number;
	availableMethodCounts: { email: number; instagram: number; tiktok: number };
	gmailConnected: boolean;
	isCreatingDrafts: boolean;
	createDraftSuccess: string | null;
	createDraftError: string | null;
	isDrafting: boolean;
	isQuickDrafting: boolean;
	quickDraftError: string | null;
	footerModalOpen: boolean;
	influencers: Influencer[];
	campaignId?: string | null;
	navigationDirection: 'forward' | 'backward';
	onStageChange: (stage: Stage) => void;
	onEditingPlatformChange: (platform: ContactMethod | null) => void;
	onToggleMethod: (influencerKey: string, method: ContactMethod) => void;
	onSetEmailAccount: (influencerKey: string, connectionId: string) => void;
	onEvenlyAssignEmailAccounts: () => void;
	onSelectAllForMethod: (method: ContactMethod) => void;
	onUpdateMessageContent: (platform: ContactMethod, content: string) => void;
	onSaveOutreachState: (immediate: boolean) => void;
	onCreateDrafts: (method: ContactMethod) => void;
	onLoadContactedInfluencers: () => Promise<void>;
	onQuickDraft: () => void;
	onOpenDraftModal: () => void;
	onOpenFooterModal: () => void;
	onConnectGmail: () => void;
	onPreviewEmail: (content: string, recipient: { name?: string; email?: string }) => void;
	onPreviewMessage: (
		content: string,
		platform: 'instagram' | 'tiktok',
		recipient: { name?: string }
	) => void;
	getInfluencerKey: (influencer: Influencer) => string;
	getSelectedMethods: (influencerKey: string) => Set<ContactMethod>;
	isMethodSelected: (influencerKey: string, method: ContactMethod) => boolean;
	getSelectedEmailAccount: (influencerKey: string) => string | null;
	hasEmail: (influencer: Influencer) => boolean;
	areAllSelectedForMethod: (method: ContactMethod) => boolean;
	hasContactMethodSelected: (method: ContactMethod) => boolean;
	getRecipientCount: (method: ContactMethod) => number;
	getMethodIcon: (method: ContactMethod) => string;
	getMethodLabel: (method: ContactMethod) => string;
	getPlatformLogo: (platform: string | null | undefined) => string;
	getPlatformColor: (platform: string | null | undefined) => string;
	canProceedToDraft: () => boolean;
}
