SELECT
  DATE_TRUNC('month', payment_date)   AS month,
  SUM(amount_paid)                    AS total_revenue,
  SUM(amount_paid) * 12               AS arr,
  COUNT(DISTINCT invoice_id)          AS paid_invoices,
  SUM(CASE WHEN method = 'card'   THEN amount_paid ELSE 0 END) AS card_revenue,
  SUM(CASE WHEN method = 'bank'   THEN amount_paid ELSE 0 END) AS bank_revenue,
  SUM(CASE WHEN method = 'paypal' THEN amount_paid ELSE 0 END) AS paypal_revenue
FROM {{ source('finance_raw', 'finance_payments') }}
GROUP BY 1
ORDER BY 1
