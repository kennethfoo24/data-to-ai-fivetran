terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
    http = {
      source  = "hashicorp/http"
      version = "~> 3.0"
    }
  }
}

data "http" "my_ip" {
  url = "https://api.ipify.org"
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# run terraform output -raw fivetran_password
resource "random_password" "fivetran_user" {
  length  = 16
  special = false
}

# ── Cloud SQL (db-f1-micro = free tier eligible in us-central1) ───────────────

resource "google_sql_database_instance" "shopstream" {
  name             = "shopstream-postgres"
  database_version = "POSTGRES_15"
  region           = var.region

  settings {
    tier              = "db-f1-micro"
    availability_type = "ZONAL"
    disk_size         = 10
    disk_type         = "PD_SSD"

    backup_configuration {
      enabled = false
    }

    ip_configuration {
      ipv4_enabled = true

      dynamic "authorized_networks" {
        for_each = var.fivetran_ips
        content {
          name  = "fivetran-${authorized_networks.key}"
          value = authorized_networks.value
        }
      }

      authorized_networks {
        name  = "my-ip"
        value = "${data.http.my_ip.response_body}/32"
      }
    }

    database_flags {
      name  = "max_connections"
      value = "25"
    }
  }

  deletion_protection = false
}

resource "google_sql_database" "shopstream" {
  name     = "shopstream"
  instance = google_sql_database_instance.shopstream.name
}

resource "google_sql_user" "fivetran" {
  name     = "fivetran"
  instance = google_sql_database_instance.shopstream.name
  password = random_password.fivetran_user.result
}

resource "google_sql_user" "admin" {
  name     = "admin"
  instance = google_sql_database_instance.shopstream.name
  password = var.admin_password
}
