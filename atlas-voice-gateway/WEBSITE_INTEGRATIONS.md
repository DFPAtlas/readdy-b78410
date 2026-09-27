# Website integrations

The Master Voice Agent treats each website as a registered capability provider.
This lets GarageFlow, QuickGuard, GuardianHub, LetHub and future sites plug into
one orchestration layer without giving the voice console direct database access.

## Security model

- Website credentials live only on the Atlas Voice Gateway host.
- The browser receives only a safe capability catalogue.
- Read and write capabilities are labelled with risk.
- Website writes go through the website's own API/RLS/tenant checks.
- The Master Agent does not connect directly to Supabase service-role endpoints.
- Reversible writes can be enabled per site; privileged/destructive writes will
  require a stronger approval policy.

## GarageFlow first

GarageFlow is the first connector because its AI receptionist needs a complete
telephone workflow:

1. Receive call and create a voice session.
2. Identify the garage/number being called.
3. Match the caller to a customer by phone, then confirm identity-sensitive
   details before disclosing private records.
4. Find the caller's vehicle or capture the registration.
5. Understand the requested work/service.
6. Ask GarageFlow for valid workshop availability.
7. Offer available slots to the caller.
8. Reconfirm customer, vehicle, work and time.
9. Create a **provisional** booking with source `ai_receptionist`.
10. Read back the booking reference and trigger GarageFlow confirmation
    messaging.
11. Escalate to a human when confidence is low, the caller requests it, or the
    action falls outside approved receptionist capabilities.

## Current GarageFlow API blockers discovered

The current public API booking code is out of step with the current workshop
schema. The API still refers to legacy fields such as `booking_date`,
`description` and status `pending`, while the workshop schema uses
`starts_at`, `ends_at`, `title`, `service_type`,
`duration_minutes`, source `ai_receptionist` and status `provisional`.

Before live telephone booking is enabled we also need:

- customer lookup by telephone number;
- authoritative availability/slot validation;
- idempotent booking creation against the current schema;
- an auditable `ai_receptionist` booking source;
- a confirmation/escalation path.

The connector in `app/garageflow_connector.py` deliberately targets the new
contract rather than teaching the Master Agent the legacy broken payload.
