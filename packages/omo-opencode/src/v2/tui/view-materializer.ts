import type { SolidRuntime } from "../../features/tui-card"
import type { ViewNode } from "../../features/tui-sidebar/element-helpers"
import type { SolidNode } from "./solid-loader"

/**
 * Mirrors the V1 materialize() in src/tui.ts: renders the pure ViewNode tree
 * with the dynamically imported @opentui/solid runtime helpers. The produced
 * node satisfies the V2 slot/dialog JSX.Element contract (a DomNode).
 */
export function materializeViewNodes(
  nodes: readonly ViewNode[],
  solid: SolidRuntime<SolidNode>,
): SolidNode {
  const root = solid.createElement("box")
  solid.setProp(root, "flexDirection", "column")
  for (const node of nodes) {
    solid.insert(root, materializeNode(node, solid))
  }
  return root
}

function materializeNode(node: ViewNode, solid: SolidRuntime<SolidNode>): SolidNode {
  const element = solid.createElement(node.kind)
  for (const [name, value] of Object.entries(node.props)) {
    solid.setProp(element, name, value)
  }
  if (node.kind === "text") {
    solid.insert(element, node.text ?? "")
  }
  for (const child of node.children ?? []) {
    solid.insert(element, materializeNode(child, solid))
  }
  return element
}
