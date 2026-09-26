import TopBar from "@/pages/console/components/TopBar";
import ConnectionStatus from "@/pages/console/components/ConnectionStatus";
import AgentPanel from "@/pages/console/components/AgentPanel";
import ConversationFeed from "@/pages/console/components/ConversationFeed";
import ConversationControls from "@/pages/console/components/ConversationControls";
import SessionHeader from "@/pages/console/components/SessionHeader";
import VoiceControl from "@/pages/console/components/VoiceControl";
import ActivityStrip from "@/pages/console/components/ActivityStrip";
import AgentDetailsModal from "@/pages/console/components/AgentDetailsModal";
import { useVoiceConsole } from "@/pages/console/hooks/useVoiceConsole";
import type { AgentId } from "@/pages/console/types";

/**
 * Console shell.
 *
 * Desktop: compact HAL rail on the left, a dominant conversation column in the
 * centre (one combined session header + conversation toolbar, then the message
 * list, then ONE voice composer made of the microphone, live transcript, routing
 * selector and text input), and a compact TRON rail on the right.
 *
 * Below the xl breakpoint the rails collapse and the conversation + voice
 * composer stay first, with the agent cards dropping in underneath.
 */
export default function ConsolePage() {
  const console = useVoiceConsole();

  const activeAgent: AgentId | null =
    console.speakingAgent ??
    console.session.selectedAgent ??
    (console.routingMode === "auto" ? null : console.routingMode);

  const simGatewayOnline =
    console.gateway.mode === "demo"
      ? console.voiceGatewayOnline
      : console.gateway.connection === "connected";

  /**
   * LIVE mode must never present the seeded demonstration conversation as real
   * HAL / TRON work. The seed messages carry a `seed-` id, so they are simply
   * not rendered in LIVE mode until a real session produces messages. DEMO mode
   * keeps them untouched.
   */
  const liveMode = console.gateway.mode === "live";
  const conversationMessages = liveMode
    ? console.messages.filter((message) => !message.id.startsWith("seed-"))
    : console.messages;

  /** The transcript is only "simulated" when it is not coming from the gateway. */
  const transcriptSimulated = console.gateway.mode !== "live";

  const renderPanel = (agentId: AgentId) => (
    <AgentPanel
      agent={console.agents[agentId]}
      onTalk={() => console.talkTo(agentId)}
      onToggleMute={() => console.toggleMute(agentId)}
      onDetails={() => console.openDetails(agentId)}
    />
  );

  return (
    <div className="dark console-canvas flex min-h-screen w-full flex-col text-foreground-950 xl:h-screen xl:overflow-hidden">
      <TopBar
        agents={console.agents}
        gateway={console.gateway}
        mic={console.micDiagnostics}
        voiceOutput={console.voiceOutput}
        onToggleVoiceOutput={console.toggleVoiceOutput}
      />

      <ConnectionStatus nodes={console.connections} gateway={console.gateway} />

      <main className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3 md:px-6 xl:flex-row">
        <aside className="hidden w-[248px] shrink-0 xl:flex">{renderPanel("hal")}</aside>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex min-h-[340px] min-w-0 flex-1 flex-col xl:min-h-0">
            <ConversationFeed
              messages={conversationMessages}
              operatorName={console.operatorName}
              liveMode={liveMode}
              sessionSlot={
                <SessionHeader
                  sessionId={console.session.sessionId}
                  mode={console.routingMode}
                  activeAgent={activeAgent}
                  voiceState={console.voiceState}
                  startedAt={console.session.startedAt}
                  continuous={console.continuous}
                  halAvailable={console.agents.hal.available}
                  tronAvailable={console.agents.tron.available}
                  gatewayOnline={simGatewayOnline}
                  gatewayLocked={console.gateway.mode !== "demo"}
                  onToggleAgent={console.setAgentAvailable}
                  onToggleGateway={console.toggleVoiceGateway}
                  onSimulateError={console.simulateError}
                />
              }
              controlsSlot={
                <ConversationControls
                  continuous={console.continuous}
                  canStop={console.speakingAgent !== null}
                  mutedHal={console.agents.hal.isMuted}
                  mutedTron={console.agents.tron.isMuted}
                  onToggleContinuous={console.toggleContinuous}
                  onNewConversation={console.newConversation}
                  onClearTranscript={console.clearTranscript}
                  onStopSpeaking={console.stopSpeaking}
                  onToggleMute={console.toggleMute}
                />
              }
            />
          </div>

          <div className="shrink-0">
            <VoiceControl
              voiceState={console.voiceState}
              speakingAgent={console.speakingAgent}
              routingMode={console.routingMode}
              busy={console.busy}
              inputValue={console.inputValue}
              inputLevel={console.inputLevel}
              transcript={console.transcript}
              transcriptSimulated={transcriptSimulated}
              voiceError={console.voiceError}
              gatewayError={console.gatewayError}
              gatewayMode={console.gateway.mode}
              failover={console.failover}
              onRoutingChange={console.setRoutingMode}
              onMicPointerDown={console.micPointerDown}
              onMicPointerUp={console.micPointerUp}
              onMicActivate={console.micActivate}
              onInputChange={console.setInputValue}
              onSubmit={console.sendMessage}
              onRetry={console.retryVoice}
              onDismissError={console.dismissError}
              onRetryGateway={console.retryGateway}
              onDismissGateway={console.dismissGatewayError}
              onResolveFailover={console.resolveFailover}
              onDismissFailover={console.dismissFailover}
            />
          </div>
        </div>

        <aside className="hidden w-[248px] shrink-0 xl:flex">{renderPanel("tron")}</aside>
      </main>

      <section className="grid grid-cols-1 gap-3 px-4 pb-3 sm:grid-cols-2 md:px-6 xl:hidden">
        {renderPanel("hal")}
        {renderPanel("tron")}
      </section>

      <ActivityStrip events={console.events} />

      <AgentDetailsModal
        agent={console.detailsAgent ? console.agents[console.detailsAgent] : null}
        onClose={console.closeDetails}
        onTalk={(agentId) => console.talkTo(agentId)}
        onSetAvailable={console.setAgentAvailable}
      />
    </div>
  );
}