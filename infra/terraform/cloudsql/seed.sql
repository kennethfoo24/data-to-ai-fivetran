-- Run this after terraform apply
-- psql "host=<HOST> port=5432 dbname=shopstream user=admin password=admin sslmode=require" -f seed.sql

CREATE SCHEMA IF NOT EXISTS finance;

DROP TABLE IF EXISTS finance."FINANCE_PAYMENTS";
DROP TABLE IF EXISTS finance."FINANCE_INVOICES";
DROP TABLE IF EXISTS finance."CUSTOMERS";

CREATE TABLE finance."CUSTOMERS" (
  customer_id   INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  city          TEXT,
  country       TEXT,
  signup_date   DATE,
  age           INTEGER,
  loyalty_tier  TEXT
);

CREATE TABLE finance."FINANCE_INVOICES" (
  invoice_id    INTEGER PRIMARY KEY,
  customer_id   INTEGER REFERENCES finance."CUSTOMERS"(customer_id),
  amount        NUMERIC(10,2) NOT NULL,
  status        TEXT NOT NULL,
  issue_date    DATE,
  due_date      DATE NOT NULL
);

CREATE TABLE finance."FINANCE_PAYMENTS" (
  payment_id    SERIAL PRIMARY KEY,
  invoice_id    INTEGER REFERENCES finance."FINANCE_INVOICES"(invoice_id),
  amount_paid   NUMERIC(10,2) NOT NULL,
  payment_date  DATE NOT NULL,
  method        TEXT NOT NULL
);

-- Grant fivetran user read access
GRANT USAGE ON SCHEMA finance TO fivetran;
GRANT SELECT ON ALL TABLES IN SCHEMA finance TO fivetran;
ALTER DEFAULT PRIVILEGES IN SCHEMA finance GRANT SELECT ON TABLES TO fivetran;
