export interface SpriteEngine {
	kind: 'SPRITE'
	[key: string]: unknown
}

export interface WindowEngine {
	kind: 'WINDOW'
	width: number
	height: number
}

export interface TextEngine {
	kind: 'TEXT'
	[key: string]: unknown
}

export type Engine =
	| SpriteEngine
	| WindowEngine

export function clearWindow(window: SectionNode) {
	for (const child of window.children) {
		child.remove()
	}
}

export function makeWindow(window: SectionNode): WindowEngine {
	const windowEngine: WindowEngine = {
		kind: 'WINDOW',
		width: window.width,
		height: window.height
	}

	return new Proxy(windowEngine, {
		get(target, name, receiver) {
			windowEngine.width = window.width
			windowEngine.height = window.height
			if (Reflect.has(target, name)) {
				return Reflect.get(target, name, receiver)
			}
		},
		set(target, name, receiver) {
			if (Reflect.has(target, name)) {
				switch (name) {
					case 'width':
						window.resizeWithoutConstraints(receiver, windowEngine.height)
						break
					case 'height':
						window.resizeWithoutConstraints(windowEngine.width, receiver)
				}
				return Reflect.set(target, name, receiver)
			}
			return false
		}
	})
}

export function addSprite(window: SectionNode, graphic: SceneNode): SpriteEngine {
	const clone = graphic.clone()
	clone.x = 0
	clone.y = 0
	window.appendChild(clone)

	const spriteEngine: SpriteEngine = {
		kind: 'SPRITE',
	}

	return new Proxy(spriteEngine, {
		get(target, name, receiver) {
			if (Reflect.has(target, name)) {
				return Reflect.get(target, name, receiver)
			} else {
				const property = Object.getOwnPropertyDescriptor(
					Reflect.getPrototypeOf(clone),
					name
				)
				if (property !== undefined && property.get !== undefined)
					return property.get.call(clone)
			}
		},
		set(target, name, receiver) {
			switch (name) {
				case 'x':
					clone.x = receiver
					break
				case 'y':
					clone.y = receiver
			}
			return Reflect.set(target, name, receiver)
		}
	})
}

export async function addText(window: SectionNode): Promise<TextEngine> {
	const font = { family: 'Inter', style: 'Regular' }
	await figma.loadFontAsync(font)

	const text = figma.createText()
	text.fontName = font
	text.fontSize = 20
	text.fills = [ figma.util.solidPaint('#000000') ]
	window.appendChild(text)

	const textEngine: TextEngine = {
		kind: 'TEXT',
	}

	return new Proxy(textEngine, {
		get(target, name, receiver) {
			if (Reflect.has(target, name)) {
				return Reflect.get(target, name, receiver)
			} else {
				const property = Object.getOwnPropertyDescriptor(
					Reflect.getPrototypeOf(text),
					name
				)
				if (property !== undefined && property.get !== undefined)
					return property.get.call(text)
			}
		},
		set(target, name, receiver) {
			return Reflect.set(text, name, receiver)
		}
	})
}
