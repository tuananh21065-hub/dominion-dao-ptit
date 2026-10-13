// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/// @title DominionDAO
/// @notice A small ETH treasury for the PTIT Web3 practical exercise.
contract DominionDAO is AccessControl, ReentrancyGuard {
    bytes32 public constant CONTRIBUTOR_ROLE = keccak256("CONTRIBUTOR");
    bytes32 public constant STAKEHOLDER_ROLE = keccak256("STAKEHOLDER");

    uint256 public constant MIN_STAKEHOLDER_CONTRIBUTION = 0.01 ether;
    uint256 public constant VOTING_DURATION = 5 minutes;

    uint256 public totalProposals;
    uint256 public daoBalance;

    struct ProposalStruct {
        uint256 id;
        uint256 amount;
        uint256 duration;
        uint256 upvotes;
        uint256 downvotes;
        string title;
        string description;
        bool passed;
        bool paid;
        address payable beneficiary;
        address proposer;
        address executor;
    }

    struct VotedStruct {
        address voter;
        uint256 timestamp;
        bool choosen;
    }

    mapping(uint256 => ProposalStruct) private raisedProposals;
    mapping(uint256 => VotedStruct[]) private votedOn;
    mapping(address => uint256[]) private stakeholderVotes;
    mapping(address => uint256) private contributors;
    mapping(uint256 => mapping(address => bool)) private voted;

    event Action(
        address indexed initiator,
        bytes32 indexed role,
        string message,
        address indexed beneficiary,
        uint256 amount
    );

    event ContributionReceived(
        address indexed contributor,
        uint256 amount,
        uint256 totalContribution,
        bool isStakeholder
    );

    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        address indexed beneficiary,
        uint256 amount,
        uint256 votingDeadline
    );

    event VoteCast(
        uint256 indexed proposalId,
        address indexed voter,
        bool choosen
    );

    event ProposalPaid(
        uint256 indexed proposalId,
        address indexed beneficiary,
        address indexed executor,
        uint256 amount
    );

    modifier stakeholderOnly() {
        require(
            hasRole(STAKEHOLDER_ROLE, msg.sender),
            "Only stakeholders can perform this action"
        );
        _;
    }

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /// @notice Add ETH to the DAO treasury and update the caller's contribution role.
    function contribute() external payable returns (uint256) {
        require(msg.value > 0, "Contribution must be greater than 0");

        contributors[msg.sender] += msg.value;
        _grantRole(CONTRIBUTOR_ROLE, msg.sender);

        bool becameStakeholder = contributors[msg.sender] >= MIN_STAKEHOLDER_CONTRIBUTION;
        if (becameStakeholder) {
            _grantRole(STAKEHOLDER_ROLE, msg.sender);
        }

        daoBalance += msg.value;

        emit ContributionReceived(
            msg.sender,
            msg.value,
            contributors[msg.sender],
            becameStakeholder
        );
        emit Action(
            msg.sender,
            CONTRIBUTOR_ROLE,
            "CONTRIBUTION RECEIVED",
            address(this),
            msg.value
        );

        return daoBalance;
    }

    /// @notice Create a proposal payable from the current DAO balance.
    function createProposal(
        string calldata title,
        string calldata description,
        address beneficiary,
        uint256 amount
    ) external stakeholderOnly returns (uint256 proposalId) {
        require(bytes(title).length > 0, "Title is required");
        require(bytes(description).length > 0, "Description is required");
        require(beneficiary != address(0), "Invalid beneficiary address");
        require(amount > 0, "Amount must be greater than 0");
        require(amount <= daoBalance, "Insufficient DAO balance");

        proposalId = totalProposals++;
        ProposalStruct storage proposal = raisedProposals[proposalId];

        proposal.id = proposalId;
        proposal.amount = amount;
        proposal.duration = block.timestamp + VOTING_DURATION;
        proposal.title = title;
        proposal.description = description;
        proposal.beneficiary = payable(beneficiary);
        proposal.proposer = msg.sender;

        emit ProposalCreated(
            proposalId,
            msg.sender,
            beneficiary,
            amount,
            proposal.duration
        );
        emit Action(
            msg.sender,
            STAKEHOLDER_ROLE,
            "PROPOSAL RAISED",
            beneficiary,
            amount
        );
    }

    /// @notice Cast one vote per stakeholder per proposal while voting is open.
    function performVote(uint256 proposalId, bool choosen)
        external
        stakeholderOnly
        returns (VotedStruct memory voteRecord)
    {
        ProposalStruct storage proposal = _proposalOrRevert(proposalId);
        require(block.timestamp < proposal.duration, "Voting period has ended");
        require(!voted[proposalId][msg.sender], "Already voted");

        voted[proposalId][msg.sender] = true;
        stakeholderVotes[msg.sender].push(proposalId);
        voteRecord = VotedStruct(msg.sender, block.timestamp, choosen);
        votedOn[proposalId].push(voteRecord);

        if (choosen) {
            proposal.upvotes += 1;
        } else {
            proposal.downvotes += 1;
        }

        emit VoteCast(proposalId, msg.sender, choosen);
        emit Action(
            msg.sender,
            STAKEHOLDER_ROLE,
            "PROPOSAL VOTE",
            proposal.beneficiary,
            proposal.amount
        );
    }

    /// @notice Pay a proposal only after its voting deadline and only when it wins.
    function payBeneficiary(uint256 proposalId)
        external
        stakeholderOnly
        nonReentrant
        returns (uint256)
    {
        ProposalStruct storage proposal = _proposalOrRevert(proposalId);
        require(block.timestamp >= proposal.duration, "Voting period is active");
        require(!proposal.paid, "Proposal already paid");
        require(proposal.upvotes > proposal.downvotes, "Proposal did not pass");
        require(proposal.amount <= daoBalance, "Insufficient DAO balance");

        // Effects are committed before the external call. If the call fails,
        // the whole transaction reverts and these effects are rolled back.
        proposal.paid = true;
        proposal.passed = true;
        proposal.executor = msg.sender;
        daoBalance -= proposal.amount;

        (bool success, ) = proposal.beneficiary.call{value: proposal.amount}("");
        require(success, "Transfer failed");

        emit ProposalPaid(
            proposalId,
            proposal.beneficiary,
            msg.sender,
            proposal.amount
        );
        emit Action(
            msg.sender,
            STAKEHOLDER_ROLE,
            "PAYMENT TRANSFERED",
            proposal.beneficiary,
            proposal.amount
        );

        return daoBalance;
    }

    function getProposals()
        external
        view
        returns (ProposalStruct[] memory proposals)
    {
        proposals = new ProposalStruct[](totalProposals);
        for (uint256 i = 0; i < totalProposals; i++) {
            proposals[i] = raisedProposals[i];
        }
    }

    function getProposal(uint256 proposalId)
        external
        view
        returns (ProposalStruct memory)
    {
        require(proposalId < totalProposals, "Proposal does not exist");
        return raisedProposals[proposalId];
    }

    function getVotesOf(uint256 proposalId)
        external
        view
        returns (VotedStruct[] memory)
    {
        require(proposalId < totalProposals, "Proposal does not exist");
        return votedOn[proposalId];
    }

    function getStakeholderVotes(address account)
        external
        view
        returns (uint256[] memory)
    {
        return stakeholderVotes[account];
    }

    function getStakeholderBalance(address account)
        external
        view
        returns (uint256)
    {
        return contributors[account];
    }

    function getContributorBalance(address account)
        external
        view
        returns (uint256)
    {
        return contributors[account];
    }

    function isStakeholder(address account) external view returns (bool) {
        return hasRole(STAKEHOLDER_ROLE, account);
    }

    function isContributor(address account) external view returns (bool) {
        return hasRole(CONTRIBUTOR_ROLE, account);
    }

    function getBalance(address account) external view returns (uint256) {
        return contributors[account];
    }

    function hasVoted(uint256 proposalId, address account)
        external
        view
        returns (bool)
    {
        return voted[proposalId][account];
    }

    /// @dev Direct ETH transfers are rejected so daoBalance cannot drift from the treasury flow.
    receive() external payable {
        revert("Use contribute to fund the DAO");
    }

    function _proposalOrRevert(uint256 proposalId)
        private
        view
        returns (ProposalStruct storage proposal)
    {
        require(proposalId < totalProposals, "Proposal does not exist");
        proposal = raisedProposals[proposalId];
    }
}
