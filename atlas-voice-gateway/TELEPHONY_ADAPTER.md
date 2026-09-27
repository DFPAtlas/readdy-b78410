# Telephony adapter

Atlas Voice Gateway now exposes a provider-neutral telephone contract for the
GarageFlow receptionist. It intentionally does not implement a carrier's SIP
signalling itself.

## Provider lifecycle

1. Provider receives an inbound telephone call.
2. POST `/api/telephony/calls/start` with provider call ID, caller number and
   called number.
3. Gateway maps that provider call to one Atlas voice session and starts the
   GarageFlow booking workflow.
4. Provider sends each captured caller utterance to
   `/api/telephony/calls/{callId}/audio-turn`.
5. Gateway returns transcript, workflow state, reply audio reference and one
   provider action:
   - `collect_audio`
   - `transfer`
   - `callback_required`
   - `hangup`
6. Provider plays the returned audio and performs the requested call-control
   action.
7. Provider calls `/api/telephony/calls/{callId}/end` on hang-up.

## Authentication

Every `/api/telephony/*` request is fail-closed and requires the
`X-Atlas-Telephony-Secret` header to equal `TELEPHONY_SHARED_SECRET`.
If the secret is not configured, the endpoints return 503 rather than accepting
unauthenticated traffic.

## Human transfer

`GARAGEFLOW_TRANSFER_NUMBER` is server-side only. The transfer endpoint returns
the target to the authenticated telephony provider; Atlas does not claim to
bridge a PSTN/SIP call itself.

## Provider implementation next

A provider-specific adapter can now be thin. For example:

- SIP/Asterisk/FreePBX: ARI/AGI or media bridge translates call events/audio to
  this HTTP contract.
- Hosted telephony provider: webhook/media-stream handler translates provider
  events to this contract.

The GarageFlow booking workflow itself does not change when the provider changes.
