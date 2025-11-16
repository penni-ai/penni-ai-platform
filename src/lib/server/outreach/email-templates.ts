/**
 * Email template variable replacement utilities
 */

export interface TemplateVariables {
	name?: string;
	influencer_name?: string; // Primary variable used in templates
	platform?: string;
	email?: string;
	displayName?: string;
}

/**
 * Replace template variables in email content
 * Supports: {{name}}, {{influencer_name}}, {{platform}}, {{email}}, {{displayName}}
 * Note: {{influencer_name}} and {{name}} are interchangeable - both map to the influencer's name
 */
export function replaceTemplateVariables(
	content: string,
	variables: TemplateVariables
): string {
	let processed = content;
	
	// Determine the influencer name (prioritize influencer_name, fallback to name)
	const influencerName = variables.influencer_name || variables.name || 'there';
	
	// Replace all template variables with actual values
	processed = processed.replace(/\{\{influencer_name\}\}/g, influencerName);
	processed = processed.replace(/\{\{name\}\}/g, influencerName);
	processed = processed.replace(/\{\{displayName\}\}/g, variables.displayName || influencerName);
	processed = processed.replace(/\{\{platform\}\}/g, variables.platform || '');
	processed = processed.replace(/\{\{email\}\}/g, variables.email || '');
	
	return processed;
}

/**
 * Extract template variables from content (for validation/preview)
 */
export function getTemplateVariables(content: string): string[] {
	const matches = content.match(/\{\{(\w+)\}\}/g);
	if (!matches) return [];
	
	const variables = new Set<string>();
	matches.forEach(match => {
		const varName = match.replace(/\{\{|\}\}/g, '');
		variables.add(varName);
	});
	
	return Array.from(variables);
}

