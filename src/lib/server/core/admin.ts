import type { RequestEvent } from '@sveltejs/kit';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { ApiProblem, requireUser } from './api';

const parseAllowlist = (value: string | undefined): string[] =>
	(value ?? '')
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);

const uidAllowlist = () => parseAllowlist(process.env.ADMIN_UID_ALLOWLIST);
const emailAllowlist = () => parseAllowlist(process.env.ADMIN_EMAIL_ALLOWLIST);

const hasAdminClaim = (user: DecodedIdToken): boolean => {
	const claims = user as DecodedIdToken & { admin?: boolean; role?: string; roles?: string[] };
	if (claims.admin === true) return true;
	if (claims.role === 'admin') return true;
	if (Array.isArray(claims.roles) && claims.roles.includes('admin')) return true;
	return false;
};

export const isAdminUser = (user: DecodedIdToken | null | undefined): boolean => {
	if (!user) return false;
	if (hasAdminClaim(user)) return true;

	const uidList = uidAllowlist();
	if (uidList.length > 0 && uidList.includes(user.uid)) return true;

	const emailList = emailAllowlist();
	if (emailList.length > 0 && user.email && emailList.includes(user.email)) return true;

	return false;
};

export const requireAdmin = (event: RequestEvent): DecodedIdToken => {
	const user = requireUser(event);
	if (!isAdminUser(user)) {
		throw new ApiProblem({
			status: 403,
			code: 'ADMIN_REQUIRED',
			message: 'Admin access required.'
		});
	}
	return user;
};
