import { browser } from '$app/environment';

// Custom transition combining fade and slide
export function slideFade(node: Element, { axis = 'x', duration = 300, direction = 'forward' }: { axis?: 'x' | 'y'; duration?: number; direction?: 'forward' | 'backward' } = {}) {
	if (!browser) {
		return {
			duration: 0,
			css: () => ''
		};
	}
	
	const style = getComputedStyle(node);
	const opacity = +style.opacity;
	const dimension = axis === 'y' ? 'height' : 'width';
	const size = dimension === 'height' ? (node as HTMLElement).offsetHeight : (node as HTMLElement).offsetWidth;
	
	// Forward: new content comes from left, slides right (negative to 0)
	// Backward: new content comes from right, slides left (positive to 0)
	const sign = direction === 'forward' ? -1 : 1;
	
	return {
		duration,
		easing: (t: number) => t * (2 - t), // cubicOut approximation
		css: (t: number) => {
			const eased = t * (2 - t);
			return `
				opacity: ${eased * opacity};
				transform: translate${axis.toUpperCase()}(${sign * (1 - eased) * size}px);
			`;
		}
	};
}

