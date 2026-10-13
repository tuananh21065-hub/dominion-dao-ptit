import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import {
  CONTRACT_ADDRESS,
  EXPECTED_CHAIN_ID,
  EXPLORER_BASE_URL,
  NETWORK_NAME,
  formatCountdown,
  formatEth,
  getContract,
  getErrorMessage,
  getExplorerTxUrl,
  getProposalStatus,
  getProvider,
  hasWallet,
  secondsRemaining,
  shortAddress,
  statusLabel,
} from "./lib/contract";

const EMPTY_FORM = {
  title: "",
  description: "",
  beneficiary: "",
  amount: "",
};

function normalizeProposal(proposal, votes, hasVoted) {
  return {
    id: proposal.id,
    amount: proposal.amount,
    duration: proposal.duration,
    upvotes: proposal.upvotes,
    downvotes: proposal.downvotes,
    title: proposal.title,
    description: proposal.description,
    passed: proposal.passed,
    paid: proposal.paid,
    beneficiary: proposal.beneficiary,
    proposer: proposal.proposer,
    executor: proposal.executor,
    votes,
    hasVoted,
  };
}

function App() {
  const [provider, setProvider] = useState(null);
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState(null);
  const [data, setData] = useState({
    treasury: ethers.constants.Zero,
    contribution: ethers.constants.Zero,
    stakeholder: false,
    proposals: [],
  });
  const [dataError, setDataError] = useState("");
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("all");
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [expandedProposal, setExpandedProposal] = useState(null);
  const [contributionAmount, setContributionAmount] = useState("");
  const [proposalForm, setProposalForm] = useState(EMPTY_FORM);
  const [transaction, setTransaction] = useState({ status: "idle" });
  const providerRef = useRef(null);
  const accountRef = useRef("");

  const refreshData = useCallback(async (readProvider = providerRef.current, readAccount = accountRef.current) => {
    if (!readProvider || !CONTRACT_ADDRESS) return;
    setLoading(true);
    setDataError("");
    try {
      const network = await readProvider.getNetwork();
      setChainId(Number(network.chainId));
      const readContract = getContract(readProvider);
      const [treasury, rawProposals] = await Promise.all([
        readContract.daoBalance(),
        readContract.getProposals(),
      ]);

      const [contribution, stakeholder] = readAccount
        ? await Promise.all([
            readContract["getBalance(address)"]
              ? readContract["getBalance(address)"](readAccount).catch(() =>
                  readContract["getBalance()"]({ from: readAccount }).catch(() => ethers.constants.Zero)
                )
              : readContract["getBalance()"]({ from: readAccount }).catch(() => ethers.constants.Zero),
            readContract["isStakeholder(address)"]
              ? readContract["isStakeholder(address)"](readAccount).catch(() =>
                  readContract["isStakeholder()"]({ from: readAccount }).catch(() => false)
                )
              : readContract["isStakeholder()"]({ from: readAccount }).catch(() => false),
          ])
        : [ethers.constants.Zero, false];

      const proposals = await rawProposals.map(async (proposal) => {
        const votes = await readContract.getVotesOf(proposal.id).catch(() => []);
        let hasVoted = false;
        if (readAccount) {
          if (typeof readContract.hasVoted === "function") {
            try {
              hasVoted = await readContract.hasVoted(proposal.id, readAccount);
            } catch {
              hasVoted = votes.some(
                (v) => v.voter && v.voter.toLowerCase() === readAccount.toLowerCase()
              );
            }
          } else {
            hasVoted = votes.some(
              (v) => v.voter && v.voter.toLowerCase() === readAccount.toLowerCase()
            );
          }
        }
        return normalizeProposal(proposal, votes, hasVoted);
      });
      const resolvedProposals = await Promise.all(proposals);

      setData({ treasury, contribution, stakeholder, proposals: resolvedProposals });
    } catch (error) {
      setDataError(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hasWallet()) return undefined;
    const nextProvider = getProvider();
    providerRef.current = nextProvider;
    setProvider(nextProvider);
    refreshData(nextProvider, "");

    const handleAccountsChanged = async (accounts) => {
      const nextAccount = accounts[0] || "";
      accountRef.current = nextAccount;
      setAccount(nextAccount);
      setExpandedProposal(null);
      await refreshData(nextProvider, nextAccount);
    };

    const handleChainChanged = async (nextChainId) => {
      const parsedChainId = Number.parseInt(nextChainId, 16);
      setChainId(parsedChainId);
      setDataError("");
      await refreshData(nextProvider, accountRef.current);
    };

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    window.ethereum.on("chainChanged", handleChainChanged);
    return () => {
      window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
      window.ethereum.removeListener("chainChanged", handleChainChanged);
    };
  }, [refreshData]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const correctNetwork = chainId === EXPECTED_CHAIN_ID;
  const configured = Boolean(CONTRACT_ADDRESS && ethers.utils.isAddress(CONTRACT_ADDRESS));

  const connectWallet = async () => {
    if (!hasWallet()) {
      setDataError("Chưa phát hiện MetaMask. Hãy cài MetaMask rồi tải lại trang.");
      return;
    }
    try {
      const nextProvider = providerRef.current || getProvider();
      const accounts = await nextProvider.send("eth_requestAccounts", []);
      const nextAccount = accounts[0] || "";
      providerRef.current = nextProvider;
      accountRef.current = nextAccount;
      setProvider(nextProvider);
      setAccount(nextAccount);
      await refreshData(nextProvider, nextAccount);
    } catch (error) {
      setDataError(getErrorMessage(error));
    }
  };

  const switchNetwork = async () => {
    if (!hasWallet()) return;
    const hexChainId = `0x${EXPECTED_CHAIN_ID.toString(16)}`;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: hexChainId }],
      });
    } catch (error) {
      if (error?.code === 4902 && EXPECTED_CHAIN_ID === 31337) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: hexChainId,
            chainName: "Local Hardhat",
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: ["http://127.0.0.1:8545"],
          }],
        });
      } else {
        setDataError(getErrorMessage(error));
      }
    }
  };

  const runTransaction = async (label, operation) => {
    if (!account) {
      await connectWallet();
      return;
    }
    if (!correctNetwork) {
      setDataError(`MetaMask đang ở sai mạng. Hãy chuyển sang ${NETWORK_NAME}.`);
      return;
    }

    setTransaction({ status: "pending", label });
    setDataError("");
    try {
      const signer = provider.getSigner(account);
      const writeContract = getContract(signer);
      const tx = await operation(writeContract);
      setTransaction({ status: "pending", label, hash: tx.hash });
      await tx.wait();
      setTransaction({ status: "success", label, hash: tx.hash });
      await refreshData(provider, account);
    } catch (error) {
      setTransaction({ status: "error", label });
      setDataError(getErrorMessage(error));
    }
  };

  const handleContribution = async (event) => {
    event.preventDefault();
    if (!contributionAmount || Number(contributionAmount) <= 0) {
      setDataError("Số ETH đóng góp phải lớn hơn 0.");
      return;
    }
    try {
      const value = ethers.utils.parseEther(contributionAmount);
      await runTransaction("Đóng góp ETH vào quỹ DAO", (contract) => contract.contribute({ value }));
      setContributionAmount("");
    } catch (error) {
      setDataError(getErrorMessage(error));
    }
  };

  const handleProposal = async (event) => {
    event.preventDefault();
    const { title, description, beneficiary, amount } = proposalForm;
    if (!title.trim() || !description.trim() || !beneficiary.trim() || !amount) {
      setDataError("Vui lòng điền đủ tiêu đề, mô tả, địa chỉ nhận và số ETH.");
      return;
    }
    if (!ethers.utils.isAddress(beneficiary)) {
      setDataError("Địa chỉ beneficiary không hợp lệ.");
      return;
    }
    if (Number(amount) <= 0) {
      setDataError("Số ETH đề xuất phải lớn hơn 0.");
      return;
    }
    try {
      const value = ethers.utils.parseEther(amount);
      await runTransaction("Tạo đề xuất chi tiền", (contract) =>
        contract.createProposal(title.trim(), description.trim(), beneficiary, value),
      );
      setProposalForm(EMPTY_FORM);
    } catch (error) {
      setDataError(getErrorMessage(error));
    }
  };

  const handleVote = async (proposalId, choice) => {
    await runTransaction(choice ? "Bỏ phiếu đồng ý" : "Bỏ phiếu phản đối", (contract) =>
      contract.performVote(proposalId, choice),
    );
  };

  const handlePayout = async (proposalId) => {
    await runTransaction("Giải ngân cho beneficiary", (contract) => contract.payBeneficiary(proposalId));
  };

  const visibleProposals = useMemo(
    () => data.proposals.filter((proposal) => filter === "all" || getProposalStatus(proposal, now) === filter),
    [data.proposals, filter, now],
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-group">
          <div className="brand-mark">D</div>
          <div>
            <p className="eyebrow">PTIT · WEB3 PRACTICAL</p>
            <h1>DominionDAO</h1>
          </div>
        </div>
        <div className="header-actions">
          <span className={`network-pill ${correctNetwork ? "online" : "offline"}`}>
            <span className="status-dot" /> {NETWORK_NAME}
          </span>
          {account ? (
            <button className="wallet-button connected" type="button" onClick={connectWallet}>
              {shortAddress(account)}
            </button>
          ) : (
            <button className="wallet-button" type="button" onClick={connectWallet}>Kết nối ví</button>
          )}
        </div>
      </header>

      <main className="page-content">
        <section className="hero-panel">
          <div>
            <p className="eyebrow accent">QUỸ CHUNG · BIỂU QUYẾT MINH BẠCH</p>
            <h2>Ra quyết định cùng nhau,<br /><span>thanh toán on-chain.</span></h2>
            <p className="hero-copy">Góp ETH để trở thành stakeholder, tạo đề xuất và bỏ phiếu. Mọi trạng thái đều được đọc trực tiếp từ DominionDAO.</p>
          </div>
          <div className="hero-orbit" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="orbit-core">DAO</div>
          </div>
        </section>

        {!configured && (
          <div className="notice danger"><strong>Thiếu cấu hình contract.</strong> Tạo <code>frontend/.env.local</code> từ file mẫu và điền địa chỉ DominionDAO.</div>
        )}
        {configured && !hasWallet() && (
          <div className="notice warning"><strong>Chưa có MetaMask.</strong> Cài MetaMask để ký giao dịch và tham gia DAO.</div>
        )}
        {configured && hasWallet() && !correctNetwork && (
          <div className="notice warning"><strong>Sai mạng.</strong> MetaMask đang ở chain ID {chainId ?? "-"}, cần {NETWORK_NAME} ({EXPECTED_CHAIN_ID}). <button className="text-button" type="button" onClick={switchNetwork}>Chuyển mạng</button></div>
        )}
        {dataError && <div className="notice danger"><strong>Có lỗi:</strong> {dataError}</div>}
        {transaction.status !== "idle" && <TransactionBanner transaction={transaction} />}

        <section className="stats-grid">
          <StatCard label="Số dư quỹ DAO" value={`${formatEth(data.treasury)} ETH`} detail="daoBalance hiện tại" icon="◈" accent="blue" />
          <StatCard label="Đóng góp của bạn" value={`${formatEth(data.contribution)} ETH`} detail={data.stakeholder ? "Stakeholder · đủ 0.01 ETH" : "Cần đủ 0.01 ETH để biểu quyết"} icon="↗" accent="mint" />
          <StatCard label="Đề xuất" value={data.proposals.length} detail="Được ghi nhận on-chain" icon="⌁" accent="purple" />
          <StatCard label="Quyền hiện tại" value={data.stakeholder ? "Stakeholder" : "Visitor"} detail={account ? shortAddress(account, 8, 6) : "Kết nối ví để bắt đầu"} icon={data.stakeholder ? "✓" : "○"} accent="orange" />
        </section>

        <section className="action-grid">
          <article className="card action-card">
            <div className="section-heading"><div><p className="eyebrow accent">01 · TREASURY</p><h3>Đóng góp vào quỹ</h3></div><span className="icon-badge mint">↗</span></div>
            <p className="muted">Góp ETH bằng MetaMask. Tổng đóng góp từ 0.01 ETH sẽ tự động cấp quyền Stakeholder.</p>
            <form onSubmit={handleContribution} className="inline-form">
              <label><span>Số lượng</span><div className="input-with-suffix"><input value={contributionAmount} onChange={(event) => setContributionAmount(event.target.value)} inputMode="decimal" placeholder="0.010" /><b>ETH</b></div></label>
              <button className="primary-button" type="submit" disabled={loading || !configured}>Góp vào DAO <span>↗</span></button>
            </form>
          </article>

          <article className={`card action-card ${!data.stakeholder ? "locked-card" : ""}`}>
            <div className="section-heading"><div><p className="eyebrow accent">02 · GOVERNANCE</p><h3>Tạo đề xuất mới</h3></div><span className="icon-badge purple">⌁</span></div>
            {!data.stakeholder ? (
              <div className="locked-message"><span className="lock">⌑</span><div><strong>Chỉ Stakeholder</strong><p>Góp đủ 0.01 ETH để mở khóa quyền tạo proposal.</p></div></div>
            ) : (
              <form onSubmit={handleProposal} className="proposal-form">
                <label><span>Tiêu đề</span><input value={proposalForm.title} onChange={(event) => setProposalForm({ ...proposalForm, title: event.target.value })} placeholder="Ví dụ: Chi phí sự kiện nhóm" /></label>
                <label><span>Mô tả</span><textarea value={proposalForm.description} onChange={(event) => setProposalForm({ ...proposalForm, description: event.target.value })} placeholder="Mục đích sử dụng quỹ..." rows="2" /></label>
                <div className="form-row"><label><span>Địa chỉ nhận</span><input value={proposalForm.beneficiary} onChange={(event) => setProposalForm({ ...proposalForm, beneficiary: event.target.value })} placeholder="0x..." /></label><label><span>Số tiền ETH</span><input value={proposalForm.amount} onChange={(event) => setProposalForm({ ...proposalForm, amount: event.target.value })} inputMode="decimal" placeholder="0.005" /></label></div>
                <button className="primary-button" type="submit" disabled={loading || !configured}>Đăng proposal <span>↗</span></button>
              </form>
            )}
          </article>
        </section>

        <section className="proposals-section">
          <div className="section-heading proposals-heading"><div><p className="eyebrow accent">03 · GOVERNANCE FEED</p><h3>Danh sách đề xuất</h3></div><span className="count-label">{visibleProposals.length} / {data.proposals.length} proposals</span></div>
          <div className="filter-tabs" role="tablist" aria-label="Lọc đề xuất">
            {["all", "open", "passed", "rejected", "paid"].map((item) => <button key={item} type="button" className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item === "all" ? "Tất cả" : statusLabel(item)}</button>)}
          </div>
          {loading && <div className="empty-state"><span className="spinner" /> Đang đồng bộ dữ liệu on-chain...</div>}
          {!loading && visibleProposals.length === 0 && <div className="empty-state"><div className="empty-icon">⌁</div><strong>Chưa có proposal phù hợp</strong><p>Hãy tạo proposal đầu tiên sau khi trở thành Stakeholder.</p></div>}
          <div className="proposal-list">
            {visibleProposals.map((proposal) => <ProposalCard key={proposal.id.toString()} proposal={proposal} now={now} stakeholder={data.stakeholder} account={account} expanded={expandedProposal === proposal.id.toString()} onToggle={() => setExpandedProposal(expandedProposal === proposal.id.toString() ? null : proposal.id.toString())} onVote={handleVote} onPayout={handlePayout} />)}
          </div>
        </section>

        <footer className="footer"><span>DominionDAO · PTIT Web3 practical</span><span>Powered by Ethereum {NETWORK_NAME}</span>{EXPLORER_BASE_URL && <a href={`${EXPLORER_BASE_URL}/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">Xem contract ↗</a>}</footer>
      </main>
    </div>
  );
}

function StatCard({ label, value, detail, icon, accent }) {
  return <article className="stat-card"><div className={`stat-icon ${accent}`}>{icon}</div><div><p>{label}</p><strong>{value}</strong><small>{detail}</small></div></article>;
}

function TransactionBanner({ transaction }) {
  const isPending = transaction.status === "pending";
  const isError = transaction.status === "error";
  const txUrl = getExplorerTxUrl(transaction.hash);
  return <div className={`transaction-banner ${isPending ? "pending" : isError ? "error" : "success"}`}><span className="transaction-symbol">{isPending ? "◷" : isError ? "!" : "✓"}</span><div><strong>{isPending ? `Đang chờ xác nhận: ${transaction.label}` : isError ? `Giao dịch thất bại: ${transaction.label}` : `Giao dịch thành công: ${transaction.label}`}</strong>{transaction.hash && (txUrl ? <a href={txUrl} target="_blank" rel="noreferrer">Xem trên Etherscan ↗</a> : <code>{shortAddress(transaction.hash, 10, 8)}</code>)}</div></div>;
}

function ProposalCard({ proposal, now, stakeholder, expanded, onToggle, onVote, onPayout }) {
  const status = getProposalStatus(proposal, now);
  const remaining = secondsRemaining(proposal.duration, now);
  const totalVotes = proposal.upvotes.add(proposal.downvotes).toNumber();
  const upvotes = proposal.upvotes.toNumber();
  const downvotes = proposal.downvotes.toNumber();
  const upPercent = totalVotes ? (upvotes / totalVotes) * 100 : 0;
  const canVote = stakeholder && status === "open" && !proposal.hasVoted;
  const canPayout = stakeholder && status === "passed" && !proposal.paid;

  return <article className={`proposal-card ${status}`}>
    <div className="proposal-main">
      <div className="proposal-index">#{proposal.id.toString().padStart(2, "0")}</div>
      <div className="proposal-content"><div className="proposal-topline"><span className={`status-tag ${status}`}>{statusLabel(status)}</span>{status === "open" ? <span className="countdown">◷ {formatCountdown(remaining)}</span> : <span className="countdown muted-text">Đã kết thúc</span>}</div><h4>{proposal.title}</h4><p className="proposal-description">{proposal.description}</p><div className="proposal-meta"><span>Đề xuất bởi <b>{shortAddress(proposal.proposer)}</b></span><span>Nhận <b>{shortAddress(proposal.beneficiary)}</b></span></div></div>
      <div className="proposal-amount"><small>Yêu cầu</small><strong>{formatEth(proposal.amount)} <em>ETH</em></strong></div>
    </div>
    <div className="vote-strip"><div className="vote-bar"><span className="up-fill" style={{ width: `${upPercent}%` }} /></div><div className="vote-numbers"><span className="up-text">▲ {upvotes} đồng ý</span><span className="down-text">▼ {downvotes} phản đối</span></div><div className="proposal-actions">{canVote ? <><button type="button" className="vote-button yes" onClick={() => onVote(proposal.id, true)}>Đồng ý</button><button type="button" className="vote-button no" onClick={() => onVote(proposal.id, false)}>Phản đối</button></> : proposal.hasVoted ? <span className="voted-label">✓ Bạn đã bỏ phiếu</span> : canPayout ? <button type="button" className="payout-button" onClick={() => onPayout(proposal.id)}>Thanh toán ↗</button> : status === "paid" ? <span className="paid-label">✓ Đã chuyển ETH</span> : null}<button type="button" className="details-button" onClick={onToggle}>{expanded ? "Thu gọn ↑" : "Chi tiết ↓"}</button></div></div>
    {expanded && <div className="proposal-details"><div className="detail-description"><p className="eyebrow accent">CHI TIẾT PROPOSAL</p><p>{proposal.description}</p><div className="detail-grid"><span>Beneficiary<strong>{proposal.beneficiary}</strong></span><span>Người tạo<strong>{proposal.proposer}</strong></span>{proposal.executor !== ethers.constants.AddressZero && <span>Executor<strong>{proposal.executor}</strong></span>}<span>Thời hạn<strong>{new Date(Number(proposal.duration.toString()) * 1000).toLocaleString("vi-VN")}</strong></span></div></div><div className="voters-panel"><div className="voters-header"><p className="eyebrow accent">LỊCH SỬ BỎ PHIẾU</p><span>{proposal.votes.length} phiếu</span></div>{proposal.votes.length === 0 ? <p className="muted">Chưa có phiếu nào.</p> : <div className="voter-list">{proposal.votes.map((vote, index) => <div className="voter-row" key={`${vote.voter}-${index}`}><span className="voter-avatar">{vote.voter.slice(2, 4).toUpperCase()}</span><code>{shortAddress(vote.voter, 8, 6)}</code><span className={vote.choosen ? "up-text" : "down-text"}>{vote.choosen ? "Đồng ý" : "Phản đối"}</span></div>)}</div>}</div></div>}
  </article>;
}

export default App;
