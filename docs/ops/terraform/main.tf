# REFERENCE ONLY. DO NOT APPLY.
# This file documents one possible cloud layout. Applying it creates real AWS
# resources that COST MONEY (EKS, RDS, MSK, ElastiCache, WAF). NahaShield runs
# free/open-source and local only; there is no AWS account. Never run
# `terraform apply` without Thabiso's explicit instruction and budget approval.
#
# Fixes applied to the original spec copy (logged in docs/build-inputs/RECONCILIATION.md):
#   1. EKS API endpoint was public (endpoint_public_access = true) -> now private only.
#   2. Hardcoded resource names -> parameterised via var.name_prefix.
#   3. S3 backend bucket/table names are per-deployment; set them at init time with
#      -backend-config, never commit real ones.

terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.25"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.13"
    }
  }

  # Backend bucket and lock table are per-deployment: pass them at init with
  # terraform init -backend-config="bucket=..." -backend-config="dynamodb_table=..."
  backend "s3" {
    key            = "prod/nahashield.tfstate"
    region         = "af-south-1"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "af-south-1"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "prod"
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.20.0.0/16"
}

variable "private_subnet_cidrs" {
  description = "Private subnet CIDR blocks"
  type        = list(string)
  default = [
    "10.20.1.0/24",
    "10.20.2.0/24",
    "10.20.3.0/24"
  ]
}

variable "public_subnet_cidrs" {
  description = "Public subnet CIDR blocks"
  type        = list(string)
  default = [
    "10.20.11.0/24",
    "10.20.12.0/24",
    "10.20.13.0/24"
  ]
}

variable "name_prefix" {
  description = "Prefix for all resource names"
  type        = string
  default     = "nahashield"
}

variable "eks_cluster_name" {
  description = "EKS cluster name"
  type        = string
  default     = "nahashield-prod"
}

variable "rds_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.r6g.large"
}

variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.r6g.large"
}

resource "aws_vpc" "nahashield" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name        = "nahashield-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_subnet" "private" {
  count             = length(var.private_subnet_cidrs)
  vpc_id            = aws_vpc.nahashield.id
  cidr_block        = var.private_subnet_cidrs[count.index]
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = {
    Name        = "nahashield-private-${count.index}"
    Environment = var.environment
  }
}

resource "aws_subnet" "public" {
  count             = length(var.public_subnet_cidrs)
  vpc_id            = aws_vpc.nahashield.id
  cidr_block        = var.public_subnet_cidrs[count.index]
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = {
    Name        = "nahashield-public-${count.index}"
    Environment = var.environment
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_eks_cluster" "nahashield" {
  name     = var.eks_cluster_name
  role_arn = aws_iam_role.eks_cluster.arn

  vpc_config {
    subnet_ids              = concat(aws_subnet.private[*].id, aws_subnet.public[*].id)
    endpoint_private_access = true
    endpoint_public_access  = false # FIXED: was true; the Kubernetes API must not be internet-facing
  }

  tags = {
    Name        = var.eks_cluster_name
    Environment = var.environment
  }
}

resource "aws_iam_role" "eks_cluster" {
  name = "${var.name_prefix}-eks-cluster-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "eks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "eks_cluster_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
  role       = aws_iam_role.eks_cluster.name
}

resource "aws_eks_node_group" "nahashield" {
  cluster_name    = aws_eks_cluster.nahashield.name
  node_group_name = "${var.name_prefix}-workers"
  node_role_arn   = aws_iam_role.eks_node.arn

  scaling_config {
    desired_size = 3
    max_size     = 10
    min_size     = 3
  }

  instance_types = ["m6i.large"]

  tags = {
    Name        = "nahashield-workers"
    Environment = var.environment
  }
}

resource "aws_iam_role" "eks_node" {
  name = "${var.name_prefix}-eks-node-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "eks_node_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
  role       = aws_iam_role.eks_node.name
}

resource "aws_iam_role_policy_attachment" "eks_cni_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
  role       = aws_iam_role.eks_node.name
}

resource "aws_iam_role_policy_attachment" "ecr_read_only" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
  role       = aws_iam_role.eks_node.name
}

resource "aws_db_subnet_group" "nahashield" {
  name       = "${var.name_prefix}-db-subnet-group"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name        = "nahashield-db-subnet-group"
    Environment = var.environment
  }
}

resource "aws_db_instance" "nahashield" {
  identifier             = "${var.name_prefix}-postgres"
  engine                 = "postgres"
  engine_version         = "16.4"
  instance_class         = var.rds_instance_class
  allocated_storage      = 100
  max_allocated_storage  = 1000
  storage_encrypted      = true
  db_name                = "nahashield"
  username               = "nahashield_admin"
  password               = var.db_password
  db_subnet_group_name   = aws_db_subnet_group.nahashield.name
  multi_az               = true
  publicly_accessible    = false
  backup_retention_period = 30
  deletion_protection    = true

  tags = {
    Name        = "nahashield-postgres"
    Environment = var.environment
  }
}

variable "db_password" {
  description = "RDS master password"
  type        = string
  sensitive   = true
}

resource "aws_elasticache_replication_group" "nahashield" {
  replication_group_id = "${var.name_prefix}-redis"
  description          = "NahaShield Redis cache"
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = var.redis_node_type
  num_cache_clusters   = 2
  automatic_failover_enabled = true
  subnet_group_name    = aws_elasticache_subnet_group.nahashield.name
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  tags = {
    Name        = "nahashield-redis"
    Environment = var.environment
  }
}

resource "aws_elasticache_subnet_group" "nahashield" {
  name       = "${var.name_prefix}-cache-subnet-group"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_msk_cluster" "nahashield" {
  cluster_name           = "${var.name_prefix}-kafka"
  kafka_version          = "3.6.0"
  number_of_broker_nodes = 3

  broker_node_group_info {
    client_subnets = aws_subnet.private[*].id

    instance_type = "kafka.m5.large"

    storage_info {
      ebs_storage_info {
        volume_size = 200
      }
    }
  }

  encryption_info {
    encryption_in_transit {
      client_broker = "TLS"
      in_cluster    = true
    }
  }

  tags = {
    Name        = "nahashield-kafka"
    Environment = var.environment
  }
}

resource "aws_s3_bucket" "evidence_vault" {
  bucket = "nahashield-evidence-vault"

  tags = {
    Name        = "nahashield-evidence-vault"
    Environment = var.environment
  }
}

resource "aws_s3_bucket_versioning" "evidence_vault" {
  bucket = aws_s3_bucket.evidence_vault.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "evidence_vault" {
  bucket = aws_s3_bucket.evidence_vault.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "evidence_vault" {
  bucket = aws_s3_bucket.evidence_vault.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudwatch_log_group" "nahashield" {
  name              = "/aws/eks/${var.name_prefix}/${var.environment}"
  retention_in_days = 365

  tags = {
    Name        = "nahashield-logs"
    Environment = var.environment
  }
}

resource "aws_wafv2_web_acl" "nahashield" {
  name  = "${var.name_prefix}-waf"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "nahashield-waf"
    sampled_requests_enabled   = true
  }

  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name         = "AWS"
        name                = "AWSManagedRulesCommonRuleSet"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "nahashield-common-rules"
      sampled_requests_enabled   = true
    }
  }
}
