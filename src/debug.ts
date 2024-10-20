import type { Asts } from './ast'
import { clippyHash, clippyBytes } from './clippy-data'

export class EvalError extends Error {
	originalMessage: string
	node: SceneNode

	constructor({ message, node }: { message: string, node: SceneNode }) {
		super(`${message} @ ${node.type} '${node.name}'`)
		this.originalMessage = message
		this.node = node
		this.name = 'EvalError'
	}
}

function getClippy(): Image {
	const clippy = figma.getImageByHash(clippyHash)
	if (!clippy) {
		const newClippy = figma.createImage(clippyBytes)
		if (newClippy.hash !== clippyHash) throw new Error('mismatching clippy hashes!')
		return newClippy
	}
	return clippy
}

export type ClippyVariant = 'WARNING' | 'ERROR'

const clippyPrefix = '__clippy__'

export async function clearClippies(variant: ClippyVariant): Promise<void> {
	for (const clippy of figma.currentPage.findAll((node) => node.name.startsWith(clippyPrefix + variant))) {
		clippy.remove()
	}
}

export async function makeClippyMessage(variant: ClippyVariant, message: string, on: SceneNode): Promise<SceneNode> {
	for (const existing of figma.currentPage.findAll(node => node.name.startsWith(clippyPrefix) && node.name.endsWith(on.id))) {
		existing.remove()
	}

	const clippy = getClippy()
	const parent = on.parent ?? figma.currentPage

	const image = figma.createRectangle()
	image.resize(62, 70)
	// parent.appendChild(image)
	image.fills = [
		{
			type: 'IMAGE',
			imageHash: clippy.hash,
			scaleMode: 'FILL'
		}
	]
	image.x = on.x + on.width - 25
	image.y = on.y - 87 + 25

	const font = { family: 'Roboto Mono', style: 'Medium' }
	await figma.loadFontAsync(font)

	const text = figma.createShapeWithText()
	text.shapeType = 'SQUARE'
	text.fills = [ figma.util.solidPaint(variant === 'WARNING' ? '#FFFFCC' : '#FFC7C2') ]
	text.text.fontName = font
	text.text.fontSize = 12
	text.text.fills = [ figma.util.solidPaint('#000000') ]
	text.resize(227, 87)
	text.text.characters = `${variant === 'WARNING' ? 'warning' : 'error'}: ${message}`
	text.x = image.x + 62
	text.y = image.y - 6.5

	const group = figma.group([ image, text ], parent)
	group.name = clippyPrefix + variant + on.id

	return group
}

export function WARN(message: string, node: SceneNode): void {
	console.warn(`${message} @ ${node.type} '${node.name}'`)
	void makeClippyMessage('WARNING', message, node)
}

export function ERROR(message: string, node: SceneNode): never {
	throw new EvalError({ message, node })
}

let _loop = 0
export function checkLoop() {
	if (++_loop >= 10000) throw new Error('Max Lexi stack exceeded.')
}

export function resetLoop() {
	_loop = 0
}

export function indent(text: string, levels: number): string {
	return text.split('\n').map(line => '  '.repeat(levels) + line).join('\n')
}

export function stringifyAst(node: Asts): string {
	switch (node.kind) {
		case 'WINDOW': {
			return [
				'window',
				indent(node.setup ? stringifyAst(node.setup) : 'no setup', 1),
				indent(node.loop ? stringifyAst(node.loop) : 'no loop', 1),
			].join('\n')
		}

		case 'FLOW': {
			return `flow '${node.name}'\n`
				+ indent(node.first ? stringifyAst(node.first) : 'no instructions', 1)
		}

		case 'INSTRUCTION': {
			const lines = [ stringifyAst(node.instruction) ]

			for (const input of node.inputs) lines.push(indent('← ' + stringifyAst(input), 1))
			for (const output of node.outputs) lines.push(indent('→ ' + stringifyAst(output), 1))

			if (node.matchArms) {
				for (const [ key, value ] of node.matchArms) {
					lines.push(indent(`match '${key}':`, 1))
					lines.push(indent(stringifyAst(value), 2))
				}
			}

			if (node.next) lines.push(stringifyAst(node.next))
			return lines.join('\n')
		}

		case 'GRAPHIC': {
			return '[graphic]'
		}

		case 'FILE': {
			return '[file]'
		}

		case 'INFIX': {
			let string = 'infix '
			if (node.left) string += `[${stringifyAst(node.left)}] `
			string += `${node.operator}`
			if (node.right) string += ` [${stringifyAst(node.right)}]`
			return string
		}

		case 'FUNCTION': {
			return `function '${node.text}'`
		}

		case 'NUMBER': {
			return `number ${node.value}`
		}

		case 'STRING': {
			return `string '${node.value}'`
		}

		case 'VARIABLE': {
			return `variable '${node.name}' (${node.at.id})`
		}

		case 'PROPERTY': {
			let string = `property '${node.name}' of`
			if (node.parent === 'CURRENT_WINDOW') {
				string += ' current window'
			} else {
				string += ':\n' + indent(stringifyAst(node.parent), 1)
			}
			return string
		}
	}
}
