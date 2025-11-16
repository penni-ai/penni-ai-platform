import { ApiProblem, apiOk, handleApiRoute, requireUser } from '$lib/server/core';
import { campaignDocRef } from '$lib/server/core';
import { serializeCampaignRecord } from '$lib/server/campaigns';
import { createDraftsViaGmail, sendEmailsViaGmail, getGmailConnection } from '$lib/server/gmail';
import { canUseOutreach } from '$lib/server/billing';
import { replaceTemplateVariables } from '$lib/server/outreach/email-templates';
import { generateEmailFooter } from '$lib/server/outreach/email-footer';
import { incrementOutreachUsage, getOutreachUsage } from '$lib/server/usage';
import { userDocRef, outreachContactsCollectionRef } from '$lib/server/core/firestore';
import type { UserEmailSettings, OutreachContact } from '$lib/server/core/firestore';
import { clearSelectionsAfterSend } from '$lib/server/outreach/clear-selections';

export const POST = handleApiRoute(async (event) => {
	const user = requireUser(event);
	
	// Check if user has outreach capabilities
	const hasOutreach = await canUseOutreach(user.uid);
	if (!hasOutreach) {
		throw new ApiProblem({
			status: 403,
			code: 'OUTREACH_NOT_AVAILABLE',
			message: 'Outreach capabilities are not available on your current plan.',
			hint: 'Upgrade to Starter, Growth, or Event plan to access outreach features.'
		});
	}
	
	// Support both old format (influencerIds) and new format (recipients)
	let body: { 
		campaignId?: string; // Campaign ID for tracking outreach contacts
		influencerIds?: string[]; 
		recipients?: Array<{
			influencerId: string;
			email: string;
			name?: string;
			platform?: string;
		}>;
		emailContent: string; 
		platform?: string; 
		senderConnectionId?: string | null;
		subject?: string;
	};
	try {
		body = await event.request.json();
	} catch (error) {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_JSON',
			message: 'Request body must be valid JSON.',
			hint: 'Send a JSON payload with recipients (or influencerIds), emailContent, and optional platform.',
			cause: error
		});
	}

	// Validate recipients or influencerIds
	const hasRecipients = Array.isArray(body.recipients) && body.recipients.length > 0;
	const hasInfluencerIds = Array.isArray(body.influencerIds) && body.influencerIds.length > 0;
	
	if (!hasRecipients && !hasInfluencerIds) {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_RECIPIENTS',
			message: 'recipients or influencerIds must be a non-empty array.'
		});
	}

	if (!body.emailContent || typeof body.emailContent !== 'string') {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_EMAIL_CONTENT',
			message: 'emailContent is required and must be a string.'
		});
	}

	const platform = body.platform || 'gmail';
	
	const senderConnectionId = body.senderConnectionId ?? null;
	if (platform === 'gmail') {
		try {
			await getGmailConnection(user.uid, senderConnectionId ?? null);
		} catch (error) {
			throw new ApiProblem({
				status: 403,
				code: 'GMAIL_NOT_CONNECTED',
				message: 'Gmail is not connected. Please connect your Gmail account first.',
				hint: 'Visit the outreach panel and click "Connect Gmail".'
			});
		}
	}

	const requestedCount = hasRecipients ? body.recipients!.length : body.influencerIds!.length;
	
	// Fetch user's email settings for footer and directSend preference
	let emailSettings: UserEmailSettings | null = null;
	try {
		const userDoc = await userDocRef(user.uid).get();
		emailSettings = userDoc.data()?.emailSettings as UserEmailSettings | undefined || null;
	} catch (error) {
		// Log but don't fail - footer is optional
		console.error('Failed to fetch email settings:', error);
	}
	
	const directSend = emailSettings?.directSend ?? false;
	const footerHtml = generateEmailFooter(emailSettings);

	// Fetch campaign data to get business name for email subject
	let businessName: string | null = null;
	if (body.campaignId) {
		try {
			const campaignDoc = await campaignDocRef(user.uid, body.campaignId).get();
			if (campaignDoc.exists) {
				const campaignData = campaignDoc.data() ?? {};
				const campaign = await serializeCampaignRecord(campaignData, campaignDoc.id, user.uid);
				businessName = campaign.business_name ?? null;
			}
		} catch (error) {
			// Log but don't fail - business name is optional
			console.error('Failed to fetch campaign data for business name:', error);
		}
	}

	// Generate default subject with business name if available
	const defaultSubject = businessName 
		? `${businessName} - Partnership Opportunity`
		: 'Partnership Opportunity';

	// If direct send is enabled, check usage limits before proceeding
	if (directSend && platform === 'gmail') {
		const usage = await getOutreachUsage(user.uid);
		if (usage.remaining < requestedCount) {
			throw new ApiProblem({
				status: 403,
				code: 'OUTREACH_LIMIT_EXCEEDED',
				message: `Insufficient outreach credits. You have ${usage.remaining} remaining, but need ${requestedCount}.`,
				hint: 'Upgrade your plan or wait for your monthly limit to reset.'
			});
		}
	}

	let created = 0;
	let sent = 0;
	let failed = 0;
	const errors: string[] = [];
	const draftIds: string[] = [];
	
	if (platform === 'gmail') {
		// Process emails with template variable replacement per recipient
		const emails: Array<{ to: string; subject: string; htmlBody: string }> = [];
		
		if (hasRecipients) {
			// New format: recipients with full data
			for (const recipient of body.recipients!) {
				if (!recipient.email) {
					failed++;
					errors.push(`${recipient.influencerId}: No email address`);
					continue;
				}
				
				// Replace template variables for this recipient
				const templateVars = {
					name: recipient.name || 'there',
					influencer_name: recipient.name || 'there', // Primary variable used in templates
					displayName: recipient.name || 'there',
					platform: recipient.platform || '',
					email: recipient.email
				};
				
				let processedContent = replaceTemplateVariables(body.emailContent, templateVars);
				
				// Append footer if enabled
				if (footerHtml) {
					processedContent = processedContent + footerHtml;
				}
				
				emails.push({
					to: recipient.email,
					subject: body.subject || defaultSubject,
					htmlBody: processedContent
				});
			}
		} else {
			// Legacy format: influencerIds only (fallback for backwards compatibility)
			// TODO: Fetch influencer profiles to get email addresses
			// For now, this is a placeholder
			for (let i = 0; i < body.influencerIds!.length; i++) {
				emails.push({
					to: `influencer${i}@example.com`, // TODO: Fetch actual email
					subject: body.subject || defaultSubject,
					htmlBody: body.emailContent // No template replacement for legacy format
				});
			}
		}
		
		if (directSend) {
			// Send emails directly
			const result = await sendEmailsViaGmail(user.uid, emails, senderConnectionId ?? null);
			sent = result.sent;
			failed = result.failed;
			errors.push(...result.errors);
			
			// Increment usage for successfully sent emails
			if (sent > 0) {
				await incrementOutreachUsage(user.uid, sent);
			}
		} else {
		// Create drafts instead of sending
		const result = await createDraftsViaGmail(user.uid, emails, senderConnectionId ?? null);
		created = result.created;
		failed = result.failed;
		errors.push(...result.errors);
		draftIds.push(...result.draftIds);
			
			// Increment usage for successfully created drafts
			if (created > 0) {
				await incrementOutreachUsage(user.uid, created);
			}
		}
		
		// Save outreach contacts to Firestore for tracking
		if (body.campaignId && hasRecipients) {
			const contactsRef = outreachContactsCollectionRef(user.uid, body.campaignId);
			const now = Date.now();
			
			// Track which emails were successfully sent (for direct send) or created as drafts
			// Map email addresses to their success index and draft ID
			const successfulEmails = new Map<string, { index: number; draftId?: string }>();
			let successIndex = 0;
			for (let i = 0; i < emails.length; i++) {
				const email = emails[i];
				// Check if this email failed by looking at errors
				const failed = errors.some(err => err.includes(email.to));
				if (!failed) {
					// Map email to success index and draft ID if available
					const draftId = directSend ? undefined : (draftIds[successIndex] || undefined);
					successfulEmails.set(email.to, { index: successIndex, draftId });
					successIndex++;
				}
			}
			
			// Track influencers and methods that were successfully contacted (for clearing selections)
			const contactedInfluencerIds: string[] = [];
			const methodsToRemove: Record<string, string[]> = {}; // influencerKey -> methods to remove
			
			// Create contact records for all recipients with emails
			for (const recipient of body.recipients!) {
				if (!recipient.email) continue;
				
				try {
					// Replace template variables for the stored message
					const templateVars = {
						name: recipient.name || 'there',
						influencer_name: recipient.name || 'there', // Primary variable used in templates
						displayName: recipient.name || 'there',
						platform: recipient.platform || '',
						email: recipient.email
					};
					
					let processedContent = replaceTemplateVariables(body.emailContent, templateVars);
					
					// Append footer if enabled
					if (footerHtml) {
						processedContent = processedContent + footerHtml;
					}
					
					const emailSuccess = successfulEmails.get(recipient.email);
					const wasSuccessful = !!emailSuccess;
					const draftId = emailSuccess?.draftId || null;
					
					// Only clear selections for successful sends/drafts (not failed ones)
					const shouldClearSelection = directSend ? wasSuccessful : (created > 0); // For drafts, clear if any were created
					
					const contact: OutreachContact = {
						platform: 'email',
						destination: recipient.email,
						message: processedContent, // Personalized message with variables filled in
						template: body.emailContent, // Store original template for future editing
						sendStatus: directSend ? (wasSuccessful ? 'sent' : 'failed') : 'pending', // Direct send: sent/failed, Drafts: pending
						createdAt: now,
						updatedAt: now,
						influencerId: recipient.influencerId,
						influencerName: recipient.name || null,
						senderConnectionId: senderConnectionId || null,
						draftId: draftId || null,
						contactMethods: ['email'] // Track that email method was used
					};
					
					// Use influencerId as document ID for easy lookup, or generate one
					// Sanitize the ID to ensure it's valid for Firestore (no slashes, no empty strings)
					let contactId = recipient.influencerId;
					if (!contactId || contactId.trim() === '') {
						// Generate a safe ID from email and timestamp
						const safeEmail = recipient.email.replace(/[^a-zA-Z0-9]/g, '_');
						contactId = `contact_${now}_${safeEmail}`;
					} else {
						// Sanitize existing influencerId to remove any invalid characters (slashes, etc.)
						contactId = contactId.replace(/[/\\]/g, '_').replace(/[^a-zA-Z0-9_-]/g, '_');
					}
					
					// Ensure contactId is never empty
					if (!contactId || contactId.trim() === '') {
						contactId = `contact_${now}_${Math.random().toString(36).substring(2, 9)}`;
					}
					
					await contactsRef.doc(contactId).set(contact, { merge: true }); // Use merge to avoid overwriting if exists
					
					// Track for clearing selections (only for successful sends/drafts)
					if (shouldClearSelection && recipient.influencerId) {
						const influencerKey = recipient.influencerId;
						if (!contactedInfluencerIds.includes(influencerKey)) {
							contactedInfluencerIds.push(influencerKey);
						}
						if (!methodsToRemove[influencerKey]) {
							methodsToRemove[influencerKey] = [];
						}
						if (!methodsToRemove[influencerKey].includes('email')) {
							methodsToRemove[influencerKey].push('email');
						}
					}
				} catch (error) {
					// Log but don't fail the request if contact tracking fails
					console.error('Failed to save outreach contact:', error);
				}
			}
			
			// Clear selections for successfully contacted influencers
			if (contactedInfluencerIds.length > 0 && body.campaignId) {
				try {
					await clearSelectionsAfterSend(user.uid, body.campaignId, contactedInfluencerIds, methodsToRemove);
				} catch (error) {
					// Log but don't fail the request if clearing selections fails
					console.error('Failed to clear selections after send:', error);
				}
			}
		}
	} else {
		// Instagram/TikTok - not implemented yet
		throw new ApiProblem({
			status: 501,
			code: 'PLATFORM_NOT_IMPLEMENTED',
			message: `${platform} outreach is not yet implemented.`,
			hint: 'Currently only Gmail is supported.'
		});
	}

	return apiOk({
		success: true,
		created: directSend ? undefined : created,
		sent: directSend ? sent : undefined,
		failed,
		draftIds: draftIds.length > 0 ? draftIds : undefined,
		errors: errors.length > 0 ? errors : undefined
	});
}, { component: 'outreach-send' });
