import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Handle,
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
import { columnClass, ROLE_LABEL, tableRole } from "../../shared/intent.ts";
import type { DataModel, Relationship, Table } from "../../shared/types.ts";
import { NODE_WIDTH, relationColumns, useStore, visibleColumns } from "../store.ts";

type TableNodeData = { table: Table; fkColumns: Set<string>; relCols: Set<string> };
type TableNodeType = Node<TableNodeData, "table">;

const Icon = ({ d, size = 12 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const DB = "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6";
const KEY = "M15.5 7.5a4 4 0 1 1-3.9 5H9v2.5H6.5V17H3v-3l6.6-6.6a4 4 0 0 1 5.9.1zM16.5 8.5h.01";
const LINK = "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1";

function formatRows(n: number): string {
  if (n >= 1e9) return `~${(n / 1e9).toFixed(1)}B rows`;
  if (n >= 1e6) return `~${(n / 1e6).toFixed(1)}M rows`;
  if (n >= 1e4) return `~${Math.round(n / 1e3)}K rows`;
  if (n >= 1e3) return `~${(n / 1e3).toFixed(1)}K rows`;
  return `${n} row${n === 1 ? "" : "s"}`;
}

const TableNode = memo(({ data, selected }: NodeProps<TableNodeType>) => {
  const { table, fkColumns, relCols } = data;
  const role = tableRole(table);
  const shown = visibleColumns(table, relCols);
  const hidden = table.columns.length - shown.length;
  const s = useStore.getState();
  return (
    <div className={"entity" + (selected ? " selected" : "") + (role ? " role-" + role : "")} style={{ width: NODE_WIDTH }}>
      <div className="entityhead">
        <span className="entityicon"><Icon d={DB} size={17} /></span>
        <div className="entitytitle">
          <div className="entityline">
            <span className="entityname">{table.name}</span>
            {table.schema && <span className="schematag">{table.schema}</span>}
            {role && <span className="roletag">{ROLE_LABEL[role]}</span>}
          </div>
          <div className="entitysub">
            {table.rowCount != null ? formatRows(table.rowCount) : `${table.columns.length} column${table.columns.length === 1 ? "" : "s"}`}
          </div>
        </div>
        <button className="entityadd nodrag" title="Add column" onClick={(e) => (e.stopPropagation(), s.addColumn(table.id), s.openColumns(table.id))}>+</button>
      </div>
      <div className="entitycols">
        {shown.map((c) => {
          const cls = columnClass(c);
          return (
            <div className="entityrow" key={c.id}>
              <Handle type="source" position={Position.Left} id={c.id + ":l"} />
              {c.primaryKey ? (
                <span className="kbadge pk"><Icon d={KEY} />PK</span>
              ) : fkColumns.has(c.id) ? (
                <span className="kbadge fk"><Icon d={LINK} />FK</span>
              ) : (
                <span className="reqmark" title={c.nullable ? "Nullable" : "Not null"}>{c.nullable ? "" : "*"}</span>
              )}
              <span className="colcell">
                <span className={"colname" + (c.primaryKey ? " strong" : "")}>{c.name}</span>
                {c.unique && !c.primaryKey && <span className="uqtag" title="Unique">UQ</span>}
              </span>
              <span className="coltype">{c.type}</span>
              {cls && <span className={"clstag " + cls}>{cls === "pii" ? "PII" : "SENSITIVE"}</span>}
              <Handle type="source" position={Position.Right} id={c.id + ":r"} />
            </div>
          );
        })}
        {hidden > 0 && (
          <button className="entityrow more nodrag" onClick={(e) => (e.stopPropagation(), s.openColumns(table.id))}>+ {hidden} more column{hidden === 1 ? "" : "s"} — open editor</button>
        )}
        {!table.columns.length && <div className="entityrow muted">No columns</div>}
      </div>
      {table.indexes.length > 0 && (
        <div className="entityfoot">
          <span className="hash">#</span>
          <span>{table.indexes.length} index{table.indexes.length === 1 ? "" : "es"}</span>
          <span className="ixnames">{table.indexes.map((i) => i.name).join(", ")}</span>
        </div>
      )}
    </div>
  );
});

/** 1:1 when the foreign key columns are themselves unique in the child; otherwise 1:N. */
function cardinality(m: DataModel, r: Relationship): string {
  const child = m.tables.find((t) => t.id === r.fromTable);
  if (!child) return "1:N";
  const pk = child.columns.filter((c) => c.primaryKey).map((c) => c.id);
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const unique =
    same(pk, r.fromColumns) ||
    (r.fromColumns.length === 1 && !!child.columns.find((c) => c.id === r.fromColumns[0])?.unique) ||
    child.indexes.some((ix) => ix.unique && same(ix.columns, r.fromColumns));
  return unique ? "1:1" : "1:N";
}

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
          type: "default",
          markerStart: "fk-dot",
          markerEnd: "fk-dot",
          label: cardinality(model, r),
          labelShowBg: true,
          labelBgPadding: [7, 4] as [number, number],
          labelBgBorderRadius: 5,
          className: "fk-edge",
        };
      });
  }, [model, tables]);

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
      {/* Endpoint dot for relationship lines; referenced by id from each edge. */}
      <svg className="edge-defs" aria-hidden="true">
        <defs>
          <marker id="fk-dot" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto">
            <circle cx="5" cy="5" r="3.6" className="fk-dot" />
          </marker>
        </defs>
      </svg>
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
