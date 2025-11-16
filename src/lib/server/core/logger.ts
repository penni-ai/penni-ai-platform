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

const sanitize = (value: unknown): unknown => {
	if (value instanceof Error) {
		return {
			name: value.name,
			message: value.message,
			stack: value.stack
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
		}
	};
};

export function createLogger(context: LogContext): Logger {
	return buildLogger(context);
}
