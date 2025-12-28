import { describe, expect, it, vi } from 'vitest';

describe('components/outreach/transitions', () => {
	it('returns no-op transition when not in browser', async () => {
		vi.resetModules();
		vi.doMock('$app/environment', () => ({ browser: false }));

		const { slideFade } = await import('../../../src/lib/components/outreach/transitions');
		const transition = slideFade({} as any, { axis: 'x' });
		expect(transition.duration).toBe(0);
		expect(transition.css(0.5)).toBe('');
	});

	it('computes css when in browser', async () => {
		vi.resetModules();
		vi.doMock('$app/environment', () => ({ browser: true }));

		(globalThis as any).getComputedStyle = vi.fn(() => ({ opacity: '0.5' }));
		const node: any = { offsetWidth: 100, offsetHeight: 40 };

		const { slideFade } = await import('../../../src/lib/components/outreach/transitions');
		const transition = slideFade(node as any, { axis: 'x', duration: 123, direction: 'backward' });
		expect(transition.duration).toBe(123);
		expect(transition.easing(0.5)).toBeCloseTo(0.75);
		const css = transition.css(0.5);
		expect(css).toContain('opacity');
		expect(css).toContain('translateX');
	});
});
