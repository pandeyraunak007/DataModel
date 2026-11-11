import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
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
import type { Table } from "../../shared/types.ts";
import { NODE_WIDTH, useStore } from "../store.ts";

type TableNodeData = { table: Table; fkColumns: Set<string> };
type TableNodeType = Node<TableNodeData, "table">;

const TableNode = memo(({ data, selected }: NodeProps<TableNodeType>) => {
  const { table, fkColumns } = data;
  return (
    <div className={"tnode" + (selected ? " selected" : "")} style={{ width: NODE_WIDTH }}>
      <div className="tnode-head">
        <span className="tnode-name">{table.name}</span>
        {table.schema && <span className="tnode-schema">{table.schema}</span>}
      </div>
      <div className="tnode-cols">
        {table.columns.map((c) => (
          <div className="tnode-col" key={c.id}>
            <Handle type="source" position={Position.Left} id={c.id + ":l"} />
            <span className={"tnode-key" + (c.primaryKey ? " pk" : fkColumns.has(c.id) ? " fk" : "")}>
              {c.primaryKey ? "PK" : fkColumns.has(c.id) ? "FK" : ""}
            </span>
            <span className={"tnode-cname" + (c.primaryKey ? " strong" : "")}>{c.name}</span>
            <span className="tnode-type">
              {c.type}
              {!c.nullable && !c.primaryKey ? <i title="NOT NULL"> •</i> : null}
            </span>
            <Handle type="source" position={Position.Right} id={c.id + ":r"} />
          </div>
        ))}
        {!table.columns.length && <div className="tnode-empty">No columns</div>}
      </div>
    </div>
  );
});

const nodeTypes = { table: TableNode };

function Flow() {
  const model = useStore((s) => s.model);
  const selectedTableId = useStore((s) => s.selectedTableId);
  const focusTableId = useStore((s) => s.focusTableId);
  const fitNonce = useStore((s) => s.fitNonce);
  const { select, moveTables, addRelationship, deleteRelationship, deleteTable, addTable, notify } = useStore.getState();
  const rf = useReactFlow();

  const fkColumns = useMemo(() => new Set(model.relationships.flatMap((r) => r.fromColumns)), [model.relationships]);
  const [nodes, setNodes, onNodesChange] = useNodesState<TableNodeType>([]);

  useEffect(() => {
    setNodes(
      model.tables.map((t) => ({
        id: t.id,
        type: "table" as const,
        position: t.position,
        data: { table: t, fkColumns },
        selected: t.id === selectedTableId,
      })),
    );
  }, [model.tables, fkColumns, selectedTableId, setNodes]);

  const edges = useMemo<Edge[]>(() => {
    const pos = new Map(model.tables.map((t) => [t.id, t.position.x]));
    return model.relationships.map((r) => {
      const cx = pos.get(r.fromTable) ?? 0, px = pos.get(r.toTable) ?? 0;
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
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        className: "fk-edge",
      };
    });
  }, [model.relationships, model.tables]);

  useEffect(() => {
    const id = setTimeout(() => rf.fitView({ padding: 0.15, duration: 300, maxZoom: 1.1 }), 60);
    return () => clearTimeout(id);
  }, [fitNonce, rf]);

  useEffect(() => {
    if (focusTableId) rf.fitView({ nodes: [{ id: focusTableId }], duration: 300, maxZoom: 1, padding: 0.6 });
  }, [focusTableId, rf]);

  const onConnect = useCallback(
    (c: Connection) => {
      const fromCol = c.sourceHandle?.split(":")[0], toCol = c.targetHandle?.split(":")[0];
      if (!fromCol || !toCol || fromCol === toCol) return;
      addRelationship({ fromTable: c.source, fromColumns: [fromCol], toTable: c.target, toColumns: [toCol] });
      notify("Foreign key added");
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
      onPaneClick={() => select(null)}
      onConnect={onConnect}
      onEdgesDelete={(es) => es.forEach((e) => deleteRelationship(e.id))}
      onNodesDelete={(ns) => ns.forEach((n) => deleteTable(n.id))}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).classList.contains("react-flow__pane")) addTable(rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
      }}
      zoomOnDoubleClick={false}
      connectionMode={ConnectionMode.Loose}
      colorMode="system"
      minZoom={0.1}
      maxZoom={2}
      deleteKeyCode={["Backspace", "Delete"]}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeStrokeWidth={2} />
    </ReactFlow>
  );
}

export default function Canvas() {
  return (
    <ReactFlowProvider>
      <Flow />
    </ReactFlowProvider>
  );
}
