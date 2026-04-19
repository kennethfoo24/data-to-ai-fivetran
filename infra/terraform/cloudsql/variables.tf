variable "project_id" {
  description = "GCP project ID — set via TF_VAR_project_id or .env GCP_PROJECT_ID"
}

variable "region" {
  default = "us-central1"
}

variable "admin_password" {
  description = "Cloud SQL admin user password — set via TF_VAR_admin_password or .env CLOUDSQL_ADMIN_PASSWORD"
  sensitive   = true
}

# Fivetran outbound IPs — us-central1 GCP + all AP GCP regions (your account is AP)
variable "fivetran_ips" {
  default = {
    "gcp-us-central1"          = "35.192.240.48/29"
    "gcp-us-east4"             = "35.234.176.144/29"
    "gcp-us-west1"             = "35.227.135.0/29"
    "gcp-ap-singapore"         = "34.87.42.80/29"
    "gcp-ap-sydney"            = "35.244.75.240/29"
    "gcp-ap-mumbai"            = "35.200.155.200/29"
    "gcp-ap-tokyo"             = "34.146.10.144/29"
    "gcp-ap-seoul"             = "34.50.0.24/29"
    "gcp-ap-jakarta"           = "34.101.50.160/29"
    "aws-ap-singapore"         = "18.143.203.104/29"
  }
}
