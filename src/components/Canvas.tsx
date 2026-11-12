import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { memo, useCallback, useEffect, useMemo } from "react";
import { ROLE_LABEL, tableRole } from "../../shared/intent.ts";
import type { Table } from "../../shared/types.ts";
import { NODE_WIDTH, relationColumns, useStore, visibleColumns } from "../store.ts";

type TableNodeData = { table: Table; fkColumns: Set<string>; relCols: Set<string> };
type TableNodeType = Node<TableNodeData, "table">;

const TableNode = memo(({ data, selected }: NodeProps<TableNodeType>) => {
  const { table, fkColumns, relCols } = data;
  const role = tableRole(table);
  const shown = visibleColumns(table, relCols);
  const hidden = table.columns.length - shown.length;
  return (
    <div className={"entity" + (selected ? " selected" : "") + (role ? " role-" + role : "")} style={{ width: NODE_WIDTH }}>
      <div className="entityhead">
        <span className="entityname">▤ {table.name}</span>
        {role && <span className="roletag">{ROLE_LABEL[role]}</span>}
      </div>
      {shown.map((c) => (
        <div className="entityrow" key={c.id}>
          <Handle type="source" position={Position.Left} id={c.id + ":l"} />
          <span className="keymark">{c.primaryKey ? "🔑" : fkColumns.has(c.id) ? "↳" : ""}</span>
          <span className={"colname" + (c.primaryKey ? " strong" : "")}>{c.name}</span>
          <em>{c.type}{!c.nullable && !c.primaryKey ? <i title="NOT NULL"> •</i> : null}</em>
          <Handle type="source" position={Position.Right} id={c.id + ":r"} />
        </div>
      ))}
      {hidden > 0 && (
        <button className="entityrow more nodrag" onClick={(e) => (e.stopPropagation(), useStore.getState().openColumns(table.id))}>+ {hidden} more column{hidden === 1 ? "" : "s"} — open editor</button>
      )}
      {!table.columns.length && <div className="entityrow muted">No columns</div>}
    </div>
  );
});

const nodeTypes = { table: TableNode };

function Flow() {
  const model = useStore((s) => s.model);
  const diagram = useStore((s) => s.diagram);
  const selectedTableId = useStore((s) => s.selectedTableId);
  const focusTableId = useStore((s) => s.focusTableId);
  const fitNonce = useStore((s) => s.fitNonce);
  const { select, moveTables, addRelationship, deleteRelationship, deleteTable, addTable, notify } = useStore.getState();
  const rf = useReactFlow();

  const tables = useMemo(
    () => (diagram === null ? model.tables : model.tables.filter((t) => (t.subjectArea || "Unassigned") === diagram)),
    [model.tables, diagram],
  );
  const fkColumns = useMemo(() => new Set(model.relationships.flatMap((r) => r.fromColumns)), [model.relationships]);
  const relCols = useMemo(() => relationColumns(model), [model.relationships]);
  const [nodes, setNodes, onNodesChange] = useNodesState<TableNodeType>([]);

  useEffect(() => {
    setNodes(tables.map((t) => ({ id: t.id, type: "table" as const, position: t.position, data: { table: t, fkColumns, relCols }, selected: t.id === selectedTableId })));
  }, [tables, fkColumns, relCols, selectedTableId, setNodes]);

  const edges = useMemo<Edge[]>(() => {
    const pos = new Map(tables.map((t) => [t.id, t.position.x]));
    return model.relationships
      .filter((r) => pos.has(r.fromTable) && pos.has(r.toTable))
      .map((r) => {
        const cx = pos.get(r.fromTable)!, px = pos.get(r.toTable)!;
        // Leave from whichever side of each table faces the other one.
        let s = "r", t = "l";
        if (px + NODE_WIDTH < cx) (s = "l"), (t = "r");
        else if (!(cx + NODE_WIDTH < px)) (s = "r"), (t = "r");
        return {
          id: r.id,
          source: r.fromTable,
          sourceHandle: r.fromColumns[0] + ":" + s,
          target: r.toTable,
          targetHandle: r.toColumns[0] + ":" + t,
          type: "smoothstep",
          markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15 },
          className: "fk-edge",
        };
      });
  }, [model.relationships, tables]);

  useEffect(() => {
    const id = setTimeout(() => rf.fitView({ padding: 0.18, duration: 300, maxZoom: 1.05 }), 60);
    return () => clearTimeout(id);
  }, [fitNonce, rf]);

  useEffect(() => {
    if (focusTableId) rf.fitView({ nodes: [{ id: focusTableId }], duration: 300, maxZoom: 1, padding: 0.8 });
  }, [focusTableId, rf]);

  const onConnect = useCallback(
    (c: Connection) => {
      const fromCol = c.sourceHandle?.split(":")[0], toCol = c.targetHandle?.split(":")[0];
      if (!fromCol || !toCol || fromCol === toCol) return;
      addRelationship({ fromTable: c.source, fromColumns: [fromCol], toTable: c.target, toColumns: [toCol] });
      notify("Relationship added");
    },
    [addRelationship, notify],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeDragStop={(_e, _n, dragged) => moveTables(Object.fromEntries(dragged.map((n) => [n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) }])))}
      onNodeClick={(_e, n) => select(n.id)}
      onNodeDoubleClick={(_e, n) => useStore.getState().openColumns(n.id)}
      onPaneClick={() => select(null)}
      onConnect={onConnect}
      onEdgesDelete={(es) => es.forEach((e) => deleteRelationship(e.id))}
      onNodesDelete={(ns) => ns.forEach((n) => deleteTable(n.id))}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).classList.contains("react-flow__pane")) addTable(rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
      }}
      zoomOnDoubleClick={false}
      connectionMode={ConnectionMode.Loose}
      colorMode="light"
      minZoom={0.1}
      maxZoom={2}
      deleteKeyCode={["Backspace", "Delete"]}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1.3} />
      {tables.length > 0 && <MiniMap pannable zoomable nodeStrokeWidth={2} />}
      <ZoomBridge />
    </ReactFlow>
  );
}

/** Lets the bottom bar's zoom buttons reach the React Flow instance. */
export const zoom = { in: () => {}, out: () => {} };
function ZoomBridge() {
  const rf = useReactFlow();
  useEffect(() => {
    zoom.in = () => rf.zoomIn({ duration: 150 });
    zoom.out = () => rf.zoomOut({ duration: 150 });
  }, [rf]);
  return null;
}

export default function Canvas() {
  return (
    <ReactFlowProvider>
      <Flow />
    </ReactFlowProvider>
  );
}
