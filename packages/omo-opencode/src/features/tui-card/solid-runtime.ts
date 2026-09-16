export type SolidRuntime<Node> = {
  readonly createElement: (tag: string) => Node
  readonly insert: (
    parent: Node,
    child: unknown,
    marker?: unknown,
    initial?: unknown,
  ) => unknown
  readonly setProp: (
    node: Node,
    name: string,
    value: unknown,
    previous?: unknown,
  ) => unknown
}

export type NodeProps = Readonly<Record<string, unknown>>

export function createBoxNode<Node>(
  solid: SolidRuntime<Node>,
  props: NodeProps,
  children: readonly Node[] = [],
): Node {
  const element = solid.createElement("box")
  for (const [name, value] of Object.entries(props)) {
    solid.setProp(element, name, value)
  }
  for (const child of children) {
    solid.insert(element, child)
  }
  return element
}

export function createTextNode<Node>(
  solid: SolidRuntime<Node>,
  value: string,
  props: NodeProps = {},
): Node {
  const element = solid.createElement("text")
  for (const [name, prop] of Object.entries(props)) {
    solid.setProp(element, name, prop)
  }
  solid.setProp(element, "content", value)
  return element
}
