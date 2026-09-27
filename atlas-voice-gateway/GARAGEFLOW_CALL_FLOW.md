# GarageFlow telephone conversation controller

The phone receptionist uses a deterministic state machine. Natural language can
vary, but the booking lifecycle cannot skip mandatory data.

## Stages

- identify customer
- verify customer
- identify vehicle
- capture service/work required
- capture preferred date
- check authoritative GarageFlow availability
- offer only returned slots
- select one of the offered slots
- read back booking details
- require final confirmation
- create provisional booking
- complete or escalate

## Important safeguards

The controller will not:

- reveal customer-linked vehicle information before verification;
- offer a time that was not returned by GarageFlow availability;
- create a booking without customer, vehicle, service, duration, date and slot;
- treat a declined final confirmation as consent;
- continue normal booking after failed customer verification.

The controller is deliberately independent of telephony provider. Twilio,
Asterisk/FreePBX, SIP trunks, or another provider can feed the same state
machine later.
