import argparse
import json
import random
import uuid
from datetime import datetime, timedelta
from pathlib import Path

def sha256_hash(value: str) -> str:
    import hashlib
    return hashlib.sha256(value.encode()).hexdigest()

def make_person(seed: int, tenant_id: str) -> dict:
    rng = random.Random(seed)
    person_id = f"psn_{uuid.UUID(int=rng.getrandbits(128))}"
    id_number = f"{rng.randint(1000000000, 9999999999):010d}"
    return {
        "person_id": person_id,
        "tenant_id": tenant_id,
        "id_number_hash": sha256_hash(id_number),
        "full_name": f"Test Person {seed}",
        "date_of_birth": "1980-01-01",
        "phone_hash": sha256_hash(f"phone_{seed}"),
        "email_hash": sha256_hash(f"email_{seed}"),
        "address_hash": sha256_hash(f"address_{seed}")
    }

def make_claim(seed: int, tenant_id: str, person: dict) -> dict:
    rng = random.Random(seed)
    claim_id = f"clm_{uuid.UUID(int=rng.getrandbits(128))}"
    return {
        "claim_id": claim_id,
        "tenant_id": tenant_id,
        "policy_id": f"pol_{uuid.UUID(int=rng.getrandbits(128))}",
        "claim_number": f"CLM-{seed:08d}",
        "claim_type": "funeral",
        "status": "received",
        "deceased_person_id": person["person_id"],
        "claimant_person_id": person["person_id"],
        "amount_claimed_cents": rng.randint(1000000, 10000000),
        "submitted_at": (datetime(2026, 1, 1) + timedelta(seconds=seed)).isoformat(),
        "agent_id": f"agt_{rng.randint(1, 100):03d}",
        "funeral_parlour_id": f"par_{rng.randint(1, 50):03d}",
        "doctor_id": f"doc_{rng.randint(1, 50):03d}",
        "bank_account_token": f"tok_bank_{rng.randint(1, 1000):04d}",
        "device_fingerprint": f"dev_{rng.randint(1, 1000):04d}",
        "address_hash": person["address_hash"],
        "phone_hash": person["phone_hash"]
    }

def make_duplicate_pair(seed: int, tenant_id: str) -> tuple:
    person = make_person(seed, tenant_id)
    claim_a = make_claim(seed, tenant_id, person)
    claim_b = make_claim(seed + 1000000, tenant_id, person)
    return claim_a, claim_b

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--tenants", type=int, default=3)
    parser.add_argument("--claims", type=int, default=10000)
    parser.add_argument("--duplicate-claims", type=int, default=500)
    parser.add_argument("--duplicate-policies", type=int, default=250)
    parser.add_argument("--mule-accounts", type=int, default=100)
    parser.add_argument("--shared-agents", type=int, default=100)
    parser.add_argument("--shared-devices", type=int, default=100)
    parser.add_argument("--shared-addresses", type=int, default=100)
    parser.add_argument("--innocent-controls", type=int, default=1000)
    parser.add_argument("--cross-insurer-cases", type=int, default=100)
    parser.add_argument("--output-dir", type=str, default="./data")
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    tenants = [f"ten_{i:03d}" for i in range(1, args.tenants + 1)]
    claims = []

    for i in range(1, args.claims + 1):
        tenant_id = tenants[i % len(tenants)]
        person = make_person(i, tenant_id)
        claim = make_claim(i, tenant_id, person)
        claims.append(claim)

    duplicate_claims = []
    for i in range(1, args.duplicate_claims + 1):
        tenant_id = tenants[i % len(tenants)]
        claim_a, claim_b = make_duplicate_pair(i, tenant_id)
        duplicate_claims.extend([claim_a, claim_b])

    duplicate_policies = []
    for i in range(1, args.duplicate_policies + 1):
        tenant_id = tenants[i % len(tenants)]
        person = make_person(i + 2000000, tenant_id)
        policy_a = {
            "policy_id": f"pol_{uuid.UUID(int=random.Random(args.seed + i).getrandbits(128))}",
            "tenant_id": tenant_id,
            "insured_person_id": person["person_id"],
            "agent_id": f"agt_{i % 100:03d}"
        }
        policy_b = {
            "policy_id": f"pol_{uuid.UUID(int=random.Random(args.seed + i).getrandbits(128))}",
            "tenant_id": tenant_id,
            "insured_person_id": person["person_id"],
            "agent_id": f"agt_{i % 100:03d}"
        }
        duplicate_policies.extend([policy_a, policy_b])

    mule_accounts = []
    for i in range(1, args.mule_accounts + 1):
        tenant_id = tenants[i % len(tenants)]
        bank_account_token = f"tok_bank_mule_{i:04d}"
        for j in range(5):
            person = make_person(i * 1000 + j, tenant_id)
            claim = make_claim(i * 1000 + j, tenant_id, person)
            claim["bank_account_token"] = bank_account_token
            mule_accounts.append(claim)

    shared_agents = []
    for i in range(1, args.shared_agents + 1):
        tenant_id = tenants[i % len(tenants)]
        agent_id = f"agt_shared_{i:04d}"
        for j in range(5):
            person = make_person(i * 2000 + j, tenant_id)
            claim = make_claim(i * 2000 + j, tenant_id, person)
            claim["agent_id"] = agent_id
            shared_agents.append(claim)

    shared_devices = []
    for i in range(1, args.shared_devices + 1):
        tenant_id = tenants[i % len(tenants)]
        device_fingerprint = f"dev_shared_{i:04d}"
        for j in range(5):
            person = make_person(i * 3000 + j, tenant_id)
            claim = make_claim(i * 3000 + j, tenant_id, person)
            claim["device_fingerprint"] = device_fingerprint
            shared_devices.append(claim)

    shared_addresses = []
    for i in range(1, args.shared_addresses + 1):
        tenant_id = tenants[i % len(tenants)]
        address_hash = sha256_hash(f"shared_address_{i}")
        for j in range(5):
            person = make_person(i * 4000 + j, tenant_id)
            claim = make_claim(i * 4000 + j, tenant_id, person)
            claim["address_hash"] = address_hash
            shared_addresses.append(claim)

    innocent_controls = []
    for i in range(1, args.innocent_controls + 1):
        tenant_id = tenants[i % len(tenants)]
        person = make_person(i + 5000000, tenant_id)
        claim = make_claim(i + 5000000, tenant_id, person)
        innocent_controls.append(claim)

    cross_insurer_cases = []
    for i in range(1, args.cross_insurer_cases + 1):
        tenant_id = tenants[i % len(tenants)]
        person = make_person(i + 6000000, tenant_id)
        claim_a = make_claim(i + 6000000, tenant_id, person)
        claim_b = make_claim(i + 7000000, tenant_id, person)
        claim_b["insurer_id"] = "insurer_b"
        cross_insurer_cases.extend([claim_a, claim_b])

    all_claims = (
        claims
        + duplicate_claims
        + mule_accounts
        + shared_agents
        + shared_devices
        + shared_addresses
        + innocent_controls
        + cross_insurer_cases
    )

    (output_dir / "claims.jsonl").write_text(
        "\n".join(json.dumps(c) for c in all_claims)
    )

    (output_dir / "duplicate_policies.jsonl").write_text(
        "\n".join(json.dumps(p) for p in duplicate_policies)
    )

    duplicate_check_payloads = []
    for claim in all_claims[:5000]:
        duplicate_check_payloads.append({
            "request_id": f"req_{claim['claim_id']}",
            "tenant_id": claim["tenant_id"],
            "claim_id": claim["claim_id"],
            "check_scope": [
                "same_deceased",
                "same_claimant",
                "same_beneficiary",
                "same_bank_account",
                "same_phone",
                "same_device",
                "same_address",
                "same_agent",
                "same_provider",
                "same_document"
            ],
            "insured_person": {
                "person_id": claim["deceased_person_id"],
                "id_number_hash": sha256_hash(str(claim["claim_id"])),
                "full_name": f"Test Person {claim['claim_id']}",
                "date_of_birth": "1980-01-01"
            },
            "claimant": {
                "person_id": claim["claimant_person_id"],
                "id_number_hash": sha256_hash(str(claim["claim_id"])),
                "full_name": f"Test Claimant {claim['claim_id']}"
            },
            "bank_account_token": claim["bank_account_token"],
            "device_fingerprint": claim["device_fingerprint"],
            "address_hash": claim["address_hash"],
            "phone_hash": claim["phone_hash"],
            "agent_id": claim["agent_id"],
            "funeral_parlour_id": claim["funeral_parlour_id"],
            "doctor_id": claim["doctor_id"],
            "consent_id": "cns_test_consent"
        })

    (output_dir / "duplicate-check-payloads.json").write_text(
        json.dumps(duplicate_check_payloads, indent=2)
    )

if __name__ == "__main__":
    main()
