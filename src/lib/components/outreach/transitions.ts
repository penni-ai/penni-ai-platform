import { browser } from '$app/environment';

// Custom transition combining fade and slide
export function slideFade(node: Element, { axis = 'x', duration = 300 } = {}) {
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
	
	return {
		duration,
		easing: (t: number) => t * (2 - t), // cubicOut approximation
		css: (t: number) => {
			const eased = t * (2 - t);
			return `
				opacity: ${eased * opacity};
				transform: translate${axis.toUpperCase()}(${(1 - eased) * size}px);
			`;
		}
	};
}

