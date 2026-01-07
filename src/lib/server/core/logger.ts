type Severity = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = Record<string, unknown>;

export interface Logger {
	child(extra: LogContext): Logger;
	debug(message: string, meta?: LogContext): void;
	info(message: string, meta?: LogContext): void;
	warn(message: string, meta?: LogContext): void;
	error(message: string, meta?: LogContext): void;
}

const writers: Record<Severity, (line: string) => void> = {
	debug: console.debug ? console.debug.bind(console) : console.log.bind(console),
	info: console.info ? console.info.bind(console) : console.log.bind(console),
	warn: console.warn.bind(console),
	error: console.error.bind(console)
};

const SENSITIVE_KEY = /(^|_)(secret|token|password|passwd|authorization|api[_-]?key|private[_-]?key|refresh[_-]?token|access[_-]?token)($|_)/i;
const EMAIL_KEY = /(^|_)(email|email_address|from|to|from_email|to_email|sender|sender_email|recipient|recipient_email)($|_)/i;
const CONTENT_KEY = /(^|_)(subject|html|html_body|text|text_body|body|content)($|_)/i;

const isLikelyTokenString = (value: string): boolean => {
	const trimmed = value.trim();
	if (!trimmed) return false;
	if (/^Bearer\s+/i.test(trimmed)) return true;
	// JWT-like
	if (trimmed.length > 80 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)) return true;
	// Long base64-ish payloads
	if (trimmed.length > 120 && /^[A-Za-z0-9+/=_.-]+$/.test(trimmed)) return true;
	return false;
};

const redactEmail = (raw: string): string => {
	const trimmed = raw.trim();
	const match = trimmed.match(/^[^@\s]+@([^@\s]+)$/);
	if (match?.[1]) {
		return `***@${match[1].toLowerCase()}`;
	}
	if (trimmed.includes('@')) {
		return '[REDACTED_EMAIL]';
	}
	return '[REDACTED]';
};

const sanitize = (value: unknown, key?: string): unknown => {
	if (value instanceof Error) {
		return {
			name: value.name,
			message: value.message,
			stack: value.stack
		};
	}

	if (typeof key === 'string' && SENSITIVE_KEY.test(key)) {
		return '[REDACTED]';
	}

	if (typeof key === 'string' && CONTENT_KEY.test(key)) {
		return '[REDACTED]';
	}

	if (typeof key === 'string' && EMAIL_KEY.test(key)) {
		if (typeof value === 'string') return redactEmail(value);
		return '[REDACTED]';
	}

	if (typeof value === 'string' && isLikelyTokenString(value)) {
		return '[REDACTED]';
	}

	if (value && typeof value === 'object') {
		if (Array.isArray(value)) {
			return value.map((item) => sanitize(item, key));
		}
		return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [entryKey, val]) => {
			acc[entryKey] = sanitize(val, entryKey);
			return acc;
		}, {});
	}

	return value;
};

const buildLogger = (baseContext: LogContext): Logger => {
	const context = { ...baseContext };

	const write = (severity: Severity, message: string, meta?: LogContext) => {
		const entry: Record<string, unknown> = {
			timestamp: new Date().toISOString(),
			severity: severity.toUpperCase(),
			...context,
			message
		};

		if (meta) {
			for (const [key, value] of Object.entries(meta)) {
				entry[key] = sanitize(value, key);
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
		}
	};
};

export function createLogger(context: LogContext): Logger {
	return buildLogger(context);
}
