import TopBar from "@/pages/console/components/TopBar";
import ConnectionStatus from "@/pages/console/components/ConnectionStatus";
import AgentPanel from "@/pages/console/components/AgentPanel";
import ConversationFeed from "@/pages/console/components/ConversationFeed";
import ConversationControls from "@/pages/console/components/ConversationControls";
import SessionHeader from "@/pages/console/components/SessionHeader";
import LiveTranscript from "@/pages/console/components/LiveTranscript";
import VoiceControl from "@/pages/console/components/VoiceControl";
import ActivityStrip from "@/pages/console/components/ActivityStrip";
import AgentDetailsModal from "@/pages/console/components/AgentDetailsModal";
import { useVoiceConsole } from "@/pages/console/hooks/useVoiceConsole";
import type { AgentId } from "@/pages/console/types";

export default function ConsolePage() {
  const console = useVoiceConsole();

  const renderPanel = (agentId: AgentId, compact: boolean) => (
    <AgentPanel
      key={`${agentId}-${compact ? "compact" : "full"}`}
      agent={console.agents[agentId]}
      compact={compact}
      onTalk={() => console.talkTo(agentId)}
      onToggleMute={() => console.toggleMute(agentId)}
      onDetails={() => console.openDetails(agentId)}
    />
  );

  const activeAgent: AgentId | null =
    console.speakingAgent ??
    console.session.selectedAgent ??
    (console.routingMode === "auto" ? null : console.routingMode);

  const simGatewayOnline =
    console.gateway.mode === "demo"
      ? console.voiceGatewayOnline
      : console.gateway.connection === "connected";

  return (
    <div className="dark console-canvas flex min-h-screen w-full flex-col text-foreground-950 xl:h-screen xl:overflow-hidden">
      <TopBar agents={console.agents} gateway={console.gateway} />

      <ConnectionStatus nodes={console.connections} gateway={console.gateway} />

      <main className="flex min-h-0 flex-1 gap-4 px-4 py-4 md:px-6">
        <div className="hidden shrink-0 self-stretch xl:flex">{renderPanel("hal", false)}</div>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:hidden">
            {renderPanel("hal", true)}
            {renderPanel("tron", true)}
          </div>

          <ConversationFeed
            messages={console.messages}
            operatorName={console.operatorName}
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

          <LiveTranscript lines={console.transcript} />
        </div>

        <div className="hidden shrink-0 self-stretch xl:flex">{renderPanel("tron", false)}</div>
      </main>

      <VoiceControl
        voiceState={console.voiceState}
        speakingAgent={console.speakingAgent}
        routingMode={console.routingMode}
        agents={console.agents}
        continuous={console.continuous}
        busy={console.busy}
        inputValue={console.inputValue}
        voiceError={console.voiceError}
        gatewayError={console.gatewayError}
        gatewayMode={console.gateway.mode}
        failover={console.failover}
        onRoutingChange={console.setRoutingMode}
        onToggleContinuous={console.toggleContinuous}
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