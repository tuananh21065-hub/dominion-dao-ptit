import { ethers } from "ethers";
import artifact from "../abi/DominionDAO.json";

export const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || "";
export const EXPECTED_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID || 31337);
export const NETWORK_NAME = import.meta.env.VITE_NETWORK_NAME || "Local Hardhat";
export const EXPLORER_BASE_URL = import.meta.env.VITE_EXPLORER_BASE_URL || "";

export const hasWallet = () => typeof window !== "undefined" && Boolean(window.ethereum);

export function getProvider() {
  if (!hasWallet()) {
    throw new Error("Chưa phát hiện MetaMask. Hãy cài MetaMask rồi tải lại trang.");
  }
  return new ethers.providers.Web3Provider(window.ethereum, "any");
}

export function getContract(providerOrSigner) {
  if (!CONTRACT_ADDRESS || !ethers.utils.isAddress(CONTRACT_ADDRESS)) {
    throw new Error("VITE_CONTRACT_ADDRESS chưa được cấu hình đúng.");
  }
  return new ethers.Contract(CONTRACT_ADDRESS, artifact.abi, providerOrSigner);
}

export function getExplorerTxUrl(hash) {
  return EXPLORER_BASE_URL && hash ? `${EXPLORER_BASE_URL.replace(/\/$/, "")}/tx/${hash}` : "";
}

export function shortAddress(address, start = 6, end = 4) {
  if (!address) return "-";
  return `${address.slice(0, start)}…${address.slice(-end)}`;
}

export function formatEth(value, decimals = 4) {
  try {
    const formatted = Number(ethers.utils.formatEther(value || 0));
    return formatted.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
    });
  } catch {
    return "0";
  }
}

export function secondsRemaining(deadline, now = Math.floor(Date.now() / 1000)) {
  const timestamp = Number(deadline?.toString?.() || deadline || 0);
  return Math.max(0, timestamp - now);
}

export function formatCountdown(seconds) {
  const remaining = Math.max(0, Number(seconds || 0));
  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const secs = remaining % 60;
  if (days > 0) return `${days} ngày ${String(hours).padStart(2, "0")} giờ`;
  return `${String(minutes).padStart(2, "0")} phút ${String(secs).padStart(2, "0")} giây`;
}

export function getProposalStatus(proposal, now = Math.floor(Date.now() / 1000)) {
  if (!proposal) return "unknown";
  if (proposal.paid) return "paid";
  if (Number(proposal.duration.toString()) > now) return "open";
  return proposal.upvotes.gt(proposal.downvotes) ? "passed" : "rejected";
}

export function statusLabel(status) {
  return {
    open: "Đang bỏ phiếu",
    passed: "Đủ phiếu thuận",
    rejected: "Không thông qua",
    paid: "Đã thanh toán",
    unknown: "Không xác định",
  }[status] || status;
}

export function getErrorMessage(error) {
  if (error?.code === 4001 || error?.code === "ACTION_REJECTED") return "Bạn đã từ chối giao dịch trong MetaMask.";
  if (error?.error?.code === 4001) return "Bạn đã từ chối giao dịch trong MetaMask.";
  const reason = error?.error?.message || error?.reason || error?.data?.message || error?.message;
  if (reason?.includes("insufficient funds")) return "Ví không đủ ETH để trả phí gas.";
  if (reason?.includes("user rejected")) return "Bạn đã từ chối giao dịch trong MetaMask.";
  return reason || "Giao dịch thất bại. Vui lòng thử lại.";
}
