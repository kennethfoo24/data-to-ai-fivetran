output "host" {
  value       = google_sql_database_instance.shopstream.public_ip_address
  description = "Cloud SQL public IP — paste into Fivetran as Host"
}

output "port" {
  value = "5432"
}

output "database" {
  value = "shopstream"
}

output "fivetran_user" {
  value = "fivetran"
}

output "fivetran_password" {
  value     = random_password.fivetran_user.result
  sensitive = true
}

output "admin_password" {
  value     = var.admin_password
  sensitive = true
}

output "fivetran_connection_summary" {
  value = <<-EOT
    ╔══════════════════════════════════════════════════════════╗
    ║   Fivetran — Cloud SQL Connection Details                ║
    ╠══════════════════════════════════════════════════════════╣
    ║   Host:      ${google_sql_database_instance.shopstream.public_ip_address}
    ║   Port:      5432
    ║   Database:  shopstream
    ║   User:      fivetran
    ║   Password:  (run: terraform output -raw fivetran_password)
    ║   SSL:       required (Cloud SQL enforces it)
    ╚══════════════════════════════════════════════════════════╝
  EOT
}
