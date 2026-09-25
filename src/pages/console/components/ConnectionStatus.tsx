import ModeIndicator from "@/pages/console/components/ModeIndicator";
import StatusBadge from "@/components/base/StatusBadge";
import type { GatewayApi } from "@/pages/console/hooks/useVoiceGateway";
import type { ConnectionNode } from "@/pages/console/types";

interface ConnectionStatusProps {
  nodes: ConnectionNode[];
  gateway: GatewayApi;
}

/**
 * Compact frontend link monitor. Every node reports one of
 * connected / connecting / degraded / disconnected. The Voice Gateway node and
 * the mode indicator are driven by the live gateway connection state.
 */
export default function ConnectionStatus({ nodes, gateway }: ConnectionStatusProps) {
  return (
    <section className="border-b border-background-300/60 bg-background-100/60 px-4 py-2 md:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <ModeIndicator
          mode={gateway.mode}
          connection={gateway.connection}
          detail={gateway.connectionDetail}
          notice={gateway.notice}
        />

        <span className="hidden h-4 w-px bg-background-300/60 sm:block" />

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {nodes.map((node) => (
            <div
              key={node.id}
              className="flex items-center gap-2 rounded-lg border border-background-300/60 bg-background-200/50 px-2.5 py-1"
            >
              <span className="whitespace-nowrap text-[11px] text-foreground-700">
                {node.label}
              </span>
              <StatusBadge state={node.state} />
              <span className="hidden whitespace-nowrap font-label text-[9px] uppercase tracking-[0.14em] text-foreground-500 xl:block">
                {node.detail}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}