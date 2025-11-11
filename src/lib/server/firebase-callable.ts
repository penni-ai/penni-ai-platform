const isRecord = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === 'object';

export const CALLABLE_ERROR_STATUS: Record<string, number> = {
	UNAUTHENTICATED: 401,
	INVALID_ARGUMENT: 400,
	PERMISSION_DENIED: 403,
	NOT_FOUND: 404,
	DEADLINE_EXCEEDED: 504,
	INTERNAL: 500,
	UNAVAILABLE: 503,
	ABORTED: 409,
	RESOURCE_EXHAUSTED: 429
};

export interface CallableErrorInfo {
	status: number;
	code: string;
	message: string;
	rawError: Record<string, unknown> | null;
	httpStatus: number;
	rawBody: unknown;
}

export interface CallableResponsePayload {
	envelope: Record<string, unknown> | null;
	rawBody: unknown;
	error: CallableErrorInfo | null;
	parseError: unknown;
}

export async function decodeCallableResponse(response: Response): Promise<CallableResponsePayload> {
	let rawBody: unknown = null;
	let parseError: unknown = null;
	try {
		rawBody = await response.json();
	} catch (error) {
		parseError = error;
	}

	const envelope = isRecord(rawBody) ? rawBody : null;
	const errorPayload = envelope && 'error' in envelope ? (envelope.error as unknown) : null;
	const normalizedError = isRecord(errorPayload) ? errorPayload : null;

	if (normalizedError || !response.ok) {
		const codeCandidate = typeof normalizedError?.status === 'string'
			? normalizedError.status
			: typeof normalizedError?.code === 'string'
				? normalizedError.code
				: undefined;
		const code = codeCandidate ?? 'FUNCTION_ERROR';
		const status =
			CALLABLE_ERROR_STATUS[code] ?? (response.status && response.status >= 400 ? response.status : 502);
		const message =
			typeof normalizedError?.message === 'string'
				? normalizedError.message
				: !response.ok
					? `Cloud Function invocation failed (${response.status})`
					: 'Cloud Function invocation failed.';

		return {
			envelope,
			rawBody,
			error: {
				status,
				code,
				message,
				rawError: normalizedError,
				httpStatus: response.status,
				rawBody
			},
			parseError
		};
	}

	return {
		envelope,
		rawBody,
		error: null,
		parseError
	};
}

export type { CallableErrorInfo as CallableError };
