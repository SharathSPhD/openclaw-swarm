import { useState, useMemo } from "react";
import { useApi } from "../hooks/useApi";

interface ResourceRequest {
  id: string;
  type: string;
  name: string;
  reason: string;
  requestedBy: string;
  round: string | null;
  status: "pending" | "approved" | "rejected" | "detected";
  ts: number;
  resolvedAt: number | null;
  resolvedBy: string | null;
  detected?: boolean;
}

interface RequestsResponse {
  requests: ResourceRequest[];
}

export default function RequestsPage() {
  const { data, refetch } = useApi<RequestsResponse>("/api/requests", 5000);
  const [isLoading, setIsLoading] = useState(false);

  const requests = data?.requests ?? [];

  const getStatusBadgeClass = (status: string, detected?: boolean) => {
    if (detected) return "chip chip-success";
    if (status === "pending") return "chip chip-warning";
    if (status === "approved") return "chip chip-success";
    if (status === "rejected") return "chip chip-error";
    return "chip";
  };

  const getStatusLabel = (status: string, detected?: boolean) => {
    if (detected) return "Detected";
    if (status === "pending") return "Pending";
    if (status === "approved") return "Approved";
    if (status === "rejected") return "Rejected";
    return status;
  };

  const handleApprove = async (id: string) => {
    setIsLoading(true);
    try {
      const apiKey = localStorage.getItem("admin-api-key") || "";
      const res = await fetch(`/api/requests/${id}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey && { "x-api-key": apiKey })
        }
      });
      if (res.ok) {
        refetch();
      } else {
        alert("Failed to approve request");
      }
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReject = async (id: string) => {
    setIsLoading(true);
    try {
      const apiKey = localStorage.getItem("admin-api-key") || "";
      const res = await fetch(`/api/requests/${id}/reject`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey && { "x-api-key": apiKey })
        }
      });
      if (res.ok) {
        refetch();
      } else {
        alert("Failed to reject request");
      }
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setIsLoading(false);
    }
  };

  const pendingRequests = useMemo(
    () => requests.filter(r => r.status === "pending"),
    [requests]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">API Token Requests</h1>
        <p className="text-sm text-swarm-muted mt-1">
          Manage resource requests from agents requiring environment tokens, API keys, and other credentials.
        </p>
      </div>

      {requests.length === 0 ? (
        <div className="panel py-12 text-center">
          <p className="text-swarm-muted">No resource requests at this time.</p>
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-swarm-muted border-b border-swarm-border">
                <th className="pb-3 pr-4">Token Name</th>
                <th className="pb-3 pr-4">Type</th>
                <th className="pb-3 pr-4">Reason</th>
                <th className="pb-3 pr-4">Requested By</th>
                <th className="pb-3 pr-4">Round</th>
                <th className="pb-3 pr-4">Status</th>
                <th className="pb-3 pr-4">Time</th>
                <th className="pb-3 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.slice().reverse().map((req) => (
                <tr key={req.id} className="border-b border-swarm-border/50">
                  <td className="py-2 pr-4 font-mono text-xs">{req.name}</td>
                  <td className="py-2 pr-4">
                    <span className="chip chip-neutral">{req.type}</span>
                  </td>
                  <td className="py-2 pr-4 text-swarm-muted max-w-xs truncate" title={req.reason}>
                    {req.reason || "—"}
                  </td>
                  <td className="py-2 pr-4">{req.requestedBy}</td>
                  <td className="py-2 pr-4 text-swarm-muted">{req.round || "—"}</td>
                  <td className="py-2 pr-4">
                    <span className={getStatusBadgeClass(req.status, req.detected)}>
                      {getStatusLabel(req.status, req.detected)}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-swarm-muted text-xs">
                    {new Date(req.ts).toLocaleString()}
                  </td>
                  <td className="py-2 pr-4">
                    {req.status === "pending" && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApprove(req.id)}
                          disabled={isLoading}
                          className="px-3 py-1 text-xs font-medium rounded bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 disabled:opacity-50 transition-colors"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleReject(req.id)}
                          disabled={isLoading}
                          className="px-3 py-1 text-xs font-medium rounded bg-red-600/20 text-red-400 hover:bg-red-600/30 disabled:opacity-50 transition-colors"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                    {req.status !== "pending" && (
                      <span className="text-swarm-muted text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pendingRequests.length > 0 && (
        <div className="panel bg-yellow-950/20 border border-yellow-900/30">
          <p className="text-sm text-yellow-400">
            {pendingRequests.length} pending request{pendingRequests.length !== 1 ? "s" : ""} awaiting approval
          </p>
        </div>
      )}
    </div>
  );
}
