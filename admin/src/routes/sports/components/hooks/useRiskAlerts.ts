import { useMemo, useRef, useEffect } from "react";
import { toast } from '@/ui/components/toast';
import { useFormatLocale } from "@/shared/core/useFormatLocale";
import type { RiskAlert } from "../types/riskAlerts";

interface RiskAlertConfig {
  enabled?: boolean;
  triggerLevels?: string[];
  notificationEnabled?: boolean;
  bannerEnabled?: boolean;
  sidebarIndicatorEnabled?: boolean;
  cooldownSeconds?: number;
}

interface EntityRisk {
  id: string;
  name: string;
  type: "player" | "agent";
  risk: {
    color: string;
    text: "HIGH" | "MEDIUM" | "LOW" | "MINIMAL" | "N/A";
  };
  metrics: {
    betCount: number;
    totalLiability: number;
    netExposure: number;
    avgOdds: number;
  };
}

export function useRiskAlerts(
  players: EntityRisk[],
  agents: EntityRisk[],
  config: RiskAlertConfig | null | undefined
) {
  const formatLocale = useFormatLocale();
  const lastAlertTimeRef = useRef<Map<string, number>>(new Map());
  const alertedEntitiesRef = useRef<Set<string>>(new Set());
  const timeoutRefsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // Calculate active alerts (without side effects)
  const activeAlerts = useMemo(() => {
    if (!config?.enabled || !config?.triggerLevels || config.triggerLevels.length === 0) {
      return [];
    }

    // Safety checks: ensure players and agents are arrays
    if (!Array.isArray(players) || !Array.isArray(agents)) {
      return [];
    }

    const alerts: RiskAlert[] = [];
    const now = Date.now();
    const cooldownMs = (config.cooldownSeconds || 60) * 1000;

    // Process players
    players.forEach((player) => {
      if (!player || !player.id || !player.risk || !config.triggerLevels?.includes(player.risk.text)) {
        return;
      }

      const entityKey = `player-${player.id}`;
      const lastAlert = lastAlertTimeRef.current.get(entityKey) || 0;

      // Check cooldown
      if (now - lastAlert < cooldownMs) {
        return;
      }

      // Create alert
      alerts.push({
        id: `${entityKey}-${now}`,
        entityId: player.id,
        entityType: "player",
        entityName: player.name || "Unknown",
        riskLevel: player.risk.text || "N/A",
        riskScore: 0, // Could calculate from metrics if needed
        metrics: {
          liability: player.metrics?.totalLiability || 0,
          exposure: Math.abs(player.metrics?.netExposure || 0),
          betCount: player.metrics?.betCount || 0,
          odds: player.metrics?.avgOdds || 0,
        },
        timestamp: new Date(),
      });
    });

    // Process agents
    agents.forEach((agent) => {
      if (!agent || !agent.id || !agent.risk || !config.triggerLevels?.includes(agent.risk.text)) {
        return;
      }

      const entityKey = `agent-${agent.id}`;
      const lastAlert = lastAlertTimeRef.current.get(entityKey) || 0;

      // Check cooldown
      if (now - lastAlert < cooldownMs) {
        return;
      }

      // Create alert
      alerts.push({
        id: `${entityKey}-${now}`,
        entityId: agent.id,
        entityType: "agent",
        entityName: agent.name || "Unknown",
        riskLevel: agent.risk.text || "N/A",
        riskScore: 0,
        metrics: {
          liability: agent.metrics?.totalLiability || 0,
          exposure: Math.abs(agent.metrics?.netExposure || 0),
          betCount: agent.metrics?.betCount || 0,
          odds: agent.metrics?.avgOdds || 0,
        },
        timestamp: new Date(),
      });
    });

    return alerts;
  }, [players, agents, config]);

  // Update cooldown timestamps in useEffect (side effect)
  useEffect(() => {
    if (activeAlerts.length === 0) {
      return;
    }

    const now = Date.now();
    activeAlerts.forEach((alert) => {
      const entityKey = `${alert.entityType}-${alert.entityId}`;
      lastAlertTimeRef.current.set(entityKey, now);
    });
  }, [activeAlerts]);

  // Trigger notifications
  useEffect(() => {
    if (!config?.enabled || !config?.notificationEnabled) {
      return;
    }
    const timeoutRefs = timeoutRefsRef.current;

    activeAlerts.forEach((alert) => {
      const alertKey = `${alert.entityId}-${alert.riskLevel}`;
      
      // Prevent duplicate notifications
      if (alertedEntitiesRef.current.has(alertKey)) {
        return;
      }

      alertedEntitiesRef.current.add(alertKey);

      const getNotificationType = () => {
        if (alert.riskLevel === "HIGH") return "error";
        if (alert.riskLevel === "MEDIUM") return "warn";
        return "info";
      };

      // Format amounts with proper locale
      const formatCurrency = (amount: number) => {
        return amount.toLocaleString(formatLocale, { 
          minimumFractionDigits: 2, 
          maximumFractionDigits: 2 
        });
      };

      toast({
        tone: getNotificationType(),
        title: `${alert.entityType === "player" ? "Player" : "Agent"} ${alert.entityName} - ${alert.riskLevel} Risk`,
        message: `Liability: ${formatCurrency(alert.metrics.liability)}, Exposure: ${formatCurrency(alert.metrics.exposure)}, Bets: ${alert.metrics.betCount}`,
        duration: 5000,
      });

      // Clean up after notification duration
      const timeout = setTimeout(() => {
        alertedEntitiesRef.current.delete(alertKey);
        timeoutRefs.delete(timeout);
      }, 5000);
      
      timeoutRefs.add(timeout);
    });

    // Cleanup function
    return () => {
      timeoutRefs.forEach((timeout) => {
        clearTimeout(timeout);
      });
      timeoutRefs.clear();
    };
  }, [activeAlerts, config, formatLocale]);

  // Get alert counts by level
  const alertCounts = useMemo(() => {
    return {
      high: activeAlerts.filter((a) => a.riskLevel === "HIGH").length,
      medium: activeAlerts.filter((a) => a.riskLevel === "MEDIUM").length,
      low: activeAlerts.filter((a) => a.riskLevel === "LOW").length,
      minimal: activeAlerts.filter((a) => a.riskLevel === "MINIMAL").length,
      total: activeAlerts.length,
    };
  }, [activeAlerts]);

  return {
    activeAlerts,
    alertCounts,
    isEnabled: config?.enabled || false,
    notificationEnabled: config?.notificationEnabled || false,
    bannerEnabled: config?.bannerEnabled || false,
    sidebarIndicatorEnabled: config?.sidebarIndicatorEnabled || false,
  };
}

