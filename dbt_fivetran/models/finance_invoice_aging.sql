SELECT
  invoice_id,
  customer_id,
  amount,
  status,
  due_date,
  CURRENT_DATE - due_date AS days_overdue,
  CASE
    WHEN status = 'paid' THEN 'paid'
    WHEN CURRENT_DATE - due_date <= 0  THEN 'current'
    WHEN CURRENT_DATE - due_date <= 30 THEN '1-30 days'
    WHEN CURRENT_DATE - due_date <= 60 THEN '31-60 days'
    ELSE '60+ days'
  END AS aging_bucket
FROM {{ source('finance_raw', 'finance_invoices') }}
