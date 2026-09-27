# Asterisk / SIP adapter

GarageFlow can now sit behind a self-hosted Asterisk PBX. The Atlas adapter uses
ARI for call control and External Media for audio.

## Asterisk side

ARI requires:

- Asterisk HTTP server enabled in `http.conf`.
- An ARI user in `ari.conf`.
- A dialplan entry that sends the GarageFlow number into
  `Stasis(atlas-garageflow)`.
- The Atlas ARI event worker connected to `/ari/events`.

Example dialplan concept:

```ini
[garageflow-ai]
exten => 7000,1,NoOp(GarageFlow AI Receptionist)
 same => n,Stasis(atlas-garageflow)
 same => n,Hangup()
```

## Call setup

On StasisStart Atlas will:

1. map the Asterisk channel ID to an Atlas telephony session;
2. answer the caller channel;
3. create a mixing bridge;
4. add the caller channel;
5. create an External Media channel;
6. add External Media to the same bridge.

External Media is configured by environment. V1 defaults to RTP/UDP with
`ulaw` because that works across a broad range of Asterisk versions. On newer
Asterisk releases we can switch to WebSocket external media to simplify packet
timing and media handling.

## Transfer

Human hand-off uses ARI channel redirect. For example:

```
GARAGEFLOW_TRANSFER_NUMBER=PJSIP/101
```

The actual endpoint must match the PBX dial technology and endpoint name.

## Security

Do not expose ARI directly to the public internet. Keep ARI on the trusted
management network or localhost/VPN, use a dedicated ARI account, and restrict
the dialplan so only the intended GarageFlow number enters this Stasis app.

## Next slice

The remaining piece is the media worker on `ASTERISK_EXTERNAL_MEDIA_HOST`.
It will:

- receive RTP/ulaw from Asterisk;
- detect end of caller speech / buffer an utterance;
- convert it to WAV/PCM for the existing faster-whisper pipeline;
- call the GarageFlow audio-turn workflow;
- convert/play the returned Piper response back into the bridge;
- support barge-in/interruption.
