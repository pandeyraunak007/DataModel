// A ready-made Finance star schema for "Explore sample model".
import { defaultIntent } from "./intent.ts";
import { applyOperations, type Operation } from "./ops.ts";
import { emptyModel, type DataModel } from "./types.ts";

const key = (name: string) => ({ name, type: "number(38,0)", primaryKey: true, autoIncrement: true });
const fk = (name: string) => ({ name, type: "number(38,0)", nullable: false });
const str = (name: string, n = 255, nullable = true) => ({ name, type: `varchar(${n})`, nullable });

export function sampleModel(): DataModel {
  const m = emptyModel("Finance Analytics Model", "snowflake");
  m.description = "Finance analytics model to support invoice, payment, customer and revenue reporting across the enterprise.";
  m.intent = {
    ...defaultIntent("STAR_SCHEMA"),
    project: "Enterprise Data Platform",
    details: {
      grain: "One row per invoice line",
      history: "Type 2 for selected dimensions",
      focus: "Invoice line and payment events",
      structures: "Customer, Date, Product and Account",
    },
  };
  const ops: Operation[] = [
    { op: "add_table", table: "DIM_CUSTOMER", subjectArea: "Customer", role: "dimension", comment: "Customer descriptive attributes and history.", columns: [key("customer_key"), str("customer_id", 40, false), str("customer_name"), str("customer_segment", 60), { name: "effective_from", type: "date", nullable: false }, { name: "effective_to", type: "date" }] },
    { op: "add_table", table: "DIM_CUSTOMER_ADDRESS", subjectArea: "Customer", role: "dimension", comment: "Customer address attributes.", columns: [key("address_key"), fk("customer_key"), str("city", 120), str("country", 80)] },
    { op: "add_table", table: "DIM_DATE", subjectArea: "Shared Dimensions", role: "dimension", comment: "Shared calendar and fiscal date attributes.", columns: [{ name: "date_key", type: "number(38,0)", primaryKey: true }, { name: "calendar_date", type: "date", nullable: false }, str("fiscal_month", 20), { name: "fiscal_year", type: "number(4,0)" }] },
    { op: "add_table", table: "DIM_ACCOUNT", subjectArea: "Shared Dimensions", role: "dimension", comment: "Chart of accounts and financial account attributes.", columns: [key("account_key"), str("account_number", 40, false), str("account_type", 60)] },
    { op: "add_table", table: "DIM_PRODUCT", subjectArea: "Sales", role: "dimension", comment: "Product descriptive attributes.", columns: [key("product_key"), str("product_name"), str("category", 80)] },
    { op: "add_table", table: "FACT_INVOICE", subjectArea: "Sales", role: "fact", comment: "Invoice line-level business event fact.", columns: [key("invoice_line_key"), fk("customer_key"), fk("date_key"), fk("product_key"), fk("account_key"), { name: "invoice_amount", type: "number(18,2)", nullable: false }, { name: "quantity", type: "number(12,0)", nullable: false }] },
    { op: "add_relationship", fromTable: "FACT_INVOICE", fromColumns: ["customer_key"], toTable: "DIM_CUSTOMER", toColumns: ["customer_key"] },
    { op: "add_relationship", fromTable: "FACT_INVOICE", fromColumns: ["date_key"], toTable: "DIM_DATE", toColumns: ["date_key"] },
    { op: "add_relationship", fromTable: "FACT_INVOICE", fromColumns: ["product_key"], toTable: "DIM_PRODUCT", toColumns: ["product_key"] },
    { op: "add_relationship", fromTable: "FACT_INVOICE", fromColumns: ["account_key"], toTable: "DIM_ACCOUNT", toColumns: ["account_key"] },
    { op: "add_relationship", fromTable: "DIM_CUSTOMER_ADDRESS", fromColumns: ["customer_key"], toTable: "DIM_CUSTOMER", toColumns: ["customer_key"] },
  ];
  return applyOperations(m, ops).model;
}
