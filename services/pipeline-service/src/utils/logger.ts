import type { Request } from 'express';

export type Severity = 'debug' | 'info' | 'warn' | 'error';
export type LogContext = Record<string, unknown>;

export interface Logger {
	child(extra: LogContext): Logger;
	debug(message: string, meta?: LogContext): void;
	info(message: string, meta?: LogContext): void;
	warn(message: string, meta?: LogContext): void;
	error(message: string, meta?: LogContext): void;
}

const severityOrder: Record<Severity, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

const defaultLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const minLevel = (defaultLevel || 'info').toLowerCase() as Severity;

const writers: Record<Severity, (line: string) => void> = {
	debug: console.debug ? console.debug.bind(console) : console.log.bind(console),
	info: console.info ? console.info.bind(console) : console.log.bind(console),
	warn: console.warn.bind(console),
	error: console.error.bind(console),
};

const sanitize = (value: unknown): unknown => {
	if (value instanceof Error) {
		return {
			name: value.name,
			message: value.message,
			stack: value.stack,
		};
	}

	if (value && typeof value === 'object') {
		if (Array.isArray(value)) {
			return value.map(sanitize);
		}
		return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [key, val]) => {
			acc[key] = sanitize(val);
			return acc;
		}, {});
	}

	return value;
};

const shouldLog = (severity: Severity): boolean => {
	return severityOrder[severity] >= (severityOrder[minLevel] ?? severityOrder.info);
};

const buildLogger = (baseContext: LogContext): Logger => {
	const context = { ...baseContext };

	const write = (severity: Severity, message: string, meta?: LogContext) => {
		if (!shouldLog(severity)) return;
		const entry: Record<string, unknown> = {
			timestamp: new Date().toISOString(),
			severity: severity.toUpperCase(),
			...context,
			message,
		};

		if (meta) {
			for (const [key, value] of Object.entries(meta)) {
				entry[key] = sanitize(value);
			}
		}

		for (const key of Object.keys(entry)) {
			if (entry[key] === undefined) {
				delete entry[key];
			}
		}

		writers[severity](JSON.stringify(entry));
	};

	return {
		child(extra: LogContext) {
			return buildLogger({ ...context, ...extra });
		},
		debug(message: string, meta?: LogContext) {
			write('debug', message, meta);
		},
		info(message: string, meta?: LogContext) {
			write('info', message, meta);
		},
		warn(message: string, meta?: LogContext) {
			write('warn', message, meta);
		},
		error(message: string, meta?: LogContext) {
			write('error', message, meta);
		},
	};
};

const getProjectId = (): string =>
	process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'unknown';

const parseTraceHeader = (header: string | string[] | undefined) => {
	if (!header) return null;
	const value = Array.isArray(header) ? header[0] : header;
	if (!value) return null;
	const [traceId, spanPart] = value.split('/');
	if (!traceId) return null;
	const [spanId, options] = (spanPart || '').split(';');
	const sampled = options?.includes('o=1');
	return { traceId, spanId: spanId || undefined, sampled };
};

export const createLogger = (context: LogContext = {}): Logger =>
	buildLogger({ service: 'pipeline-service', environment: process.env.NODE_ENV || 'unknown', ...context });

export const buildRequestContext = (req: Request): LogContext => {
	const requestIdHeader = req.headers['x-request-id'];
	const requestId = Array.isArray(requestIdHeader)
		? requestIdHeader[0]
		: requestIdHeader || undefined;
	const traceContext = parseTraceHeader(req.headers['x-cloud-trace-context']);
	const context: LogContext = {
		request_id: requestId,
		http_method: req.method,
		http_path: req.path,
		user_agent: req.headers['user-agent'],
	};

	if (traceContext?.traceId) {
		const projectId = getProjectId();
		context['logging.googleapis.com/trace'] = `projects/${projectId}/traces/${traceContext.traceId}`;
		if (traceContext.spanId) {
			context['logging.googleapis.com/spanId'] = traceContext.spanId;
		}
		if (traceContext.sampled !== undefined) {
			context['logging.googleapis.com/trace_sampled'] = traceContext.sampled;
		}
		if (!context.request_id) {
			context.request_id = traceContext.traceId;
		}
	}

	return context;
};
