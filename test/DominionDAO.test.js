const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const ether = (value) => ethers.utils.parseEther(value);

async function movePastVotingDeadline(dao) {
  const duration = await dao.VOTING_DURATION();
  await network.provider.send("evm_increaseTime", [duration.toNumber() + 1]);
  await network.provider.send("evm_mine");
}

describe("DominionDAO", function () {
  let dao;
  let owner;
  let stakeholder;
  let secondStakeholder;
  let nonStakeholder;
  let beneficiary;

  beforeEach(async function () {
    [owner, stakeholder, secondStakeholder, nonStakeholder, beneficiary] =
      await ethers.getSigners();

    const DominionDAO = await ethers.getContractFactory("DominionDAO");
    dao = await DominionDAO.deploy();
    await dao.deployed();
  });

  async function makeStakeholder(account, amount = "0.01") {
    await dao.connect(account).contribute({ value: ether(amount) });
  }

  async function createProposal(amount = "0.005") {
    await makeStakeholder(stakeholder);
    return dao
      .connect(stakeholder)
      .createProposal(
        "Community grant",
        "A valid DAO grant proposal",
        beneficiary.address,
        ether(amount)
      );
  }

  describe("contributions and roles", function () {
    it("rejects a zero ETH contribution", async function () {
      await expect(dao.connect(owner).contribute({ value: 0 })).to.be.revertedWith(
        "Contribution must be greater than 0"
      );
    });

    it("keeps a contributor below 0.01 ETH from becoming a stakeholder", async function () {
      await dao.connect(owner).contribute({ value: ether("0.009") });

      expect(await dao.isContributor(owner.address)).to.equal(true);
      expect(await dao.isStakeholder(owner.address)).to.equal(false);
      expect(await dao.getBalance(owner.address)).to.equal(ether("0.009"));
      expect(await dao.daoBalance()).to.equal(ether("0.009"));
    });

    it("grants stakeholder access once total contribution reaches 0.01 ETH", async function () {
      await dao.connect(owner).contribute({ value: ether("0.004") });
      await dao.connect(owner).contribute({ value: ether("0.006") });

      expect(await dao.isStakeholder(owner.address)).to.equal(true);
      expect(await dao.getStakeholderBalance(owner.address)).to.equal(ether("0.01"));
    });
  });

  describe("proposal validation and access", function () {
    it("does not allow non-stakeholders to create proposals", async function () {
      await expect(
        dao
          .connect(nonStakeholder)
          .createProposal("Title", "Description", beneficiary.address, ether("0.001"))
      ).to.be.revertedWith("Only stakeholders can perform this action");
    });

    it("rejects zero beneficiary, zero amount, and amount over the treasury balance", async function () {
      await makeStakeholder(stakeholder);

      await expect(
        dao
          .connect(stakeholder)
          .createProposal("Title", "Description", ethers.constants.AddressZero, ether("0.001"))
      ).to.be.revertedWith("Invalid beneficiary address");

      await expect(
        dao
          .connect(stakeholder)
          .createProposal("Title", "Description", beneficiary.address, 0)
      ).to.be.revertedWith("Amount must be greater than 0");

      await expect(
        dao
          .connect(stakeholder)
          .createProposal("Title", "Description", beneficiary.address, ether("0.011"))
      ).to.be.revertedWith("Insufficient DAO balance");
    });

    it("rejects empty proposal text", async function () {
      await makeStakeholder(stakeholder);

      await expect(
        dao
          .connect(stakeholder)
          .createProposal("", "Description", beneficiary.address, ether("0.001"))
      ).to.be.revertedWith("Title is required");

      await expect(
        dao
          .connect(stakeholder)
          .createProposal("Title", "", beneficiary.address, ether("0.001"))
      ).to.be.revertedWith("Description is required");
    });
  });

  describe("voting", function () {
    it("allows stakeholders to vote once and rejects duplicate votes", async function () {
      await createProposal();
      await expect(dao.connect(stakeholder).performVote(0, true))
        .to.emit(dao, "VoteCast")
        .withArgs(0, stakeholder.address, true);

      await expect(dao.connect(stakeholder).performVote(0, false)).to.be.revertedWith(
        "Already voted"
      );

      const proposal = await dao.getProposal(0);
      expect(proposal.upvotes).to.equal(1);
      expect(proposal.downvotes).to.equal(0);
      expect(await dao.hasVoted(0, stakeholder.address)).to.equal(true);
    });

    it("rejects votes from non-stakeholders and after the deadline", async function () {
      await createProposal();

      await expect(dao.connect(nonStakeholder).performVote(0, true)).to.be.revertedWith(
        "Only stakeholders can perform this action"
      );

      await movePastVotingDeadline(dao);
      await expect(dao.connect(stakeholder).performVote(0, true)).to.be.revertedWith(
        "Voting period has ended"
      );
    });

    it("rejects votes for a proposal that does not exist", async function () {
      await makeStakeholder(stakeholder);
      await expect(dao.connect(stakeholder).performVote(99, true)).to.be.revertedWith(
        "Proposal does not exist"
      );
    });
  });

  describe("payout", function () {
    it("rejects payout before voting ends", async function () {
      await createProposal();
      await dao.connect(stakeholder).performVote(0, true);

      await expect(dao.connect(stakeholder).payBeneficiary(0)).to.be.revertedWith(
        "Voting period is active"
      );
    });

    it("pays a winning proposal after the deadline and updates both balances", async function () {
      await makeStakeholder(stakeholder, "0.02");
      await dao
        .connect(stakeholder)
        .createProposal(
          "Community grant",
          "A valid DAO grant proposal",
          beneficiary.address,
          ether("0.005")
        );
      await dao.connect(stakeholder).performVote(0, true);
      await movePastVotingDeadline(dao);

      const beforeBeneficiary = await ethers.provider.getBalance(beneficiary.address);
      await expect(dao.connect(stakeholder).payBeneficiary(0))
        .to.emit(dao, "ProposalPaid")
        .withArgs(0, beneficiary.address, stakeholder.address, ether("0.005"));
      const afterBeneficiary = await ethers.provider.getBalance(beneficiary.address);

      expect(afterBeneficiary.sub(beforeBeneficiary)).to.equal(ether("0.005"));
      expect(await dao.daoBalance()).to.equal(ether("0.015"));
      expect((await dao.getProposal(0)).paid).to.equal(true);
      expect((await dao.getProposal(0)).passed).to.equal(true);
    });

    it("rejects a tie and a losing proposal", async function () {
      await makeStakeholder(stakeholder, "0.02");
      await makeStakeholder(secondStakeholder, "0.01");

      await dao
        .connect(stakeholder)
        .createProposal("Tie", "Tie proposal", beneficiary.address, ether("0.005"));
      await dao.connect(stakeholder).performVote(0, true);
      await dao.connect(secondStakeholder).performVote(0, false);
      await movePastVotingDeadline(dao);
      await expect(dao.connect(stakeholder).payBeneficiary(0)).to.be.revertedWith(
        "Proposal did not pass"
      );

      await dao
        .connect(stakeholder)
        .createProposal("Lose", "Losing proposal", beneficiary.address, ether("0.005"));
      await dao.connect(stakeholder).performVote(1, false);
      await expect(dao.connect(stakeholder).performVote(1, true)).to.be.revertedWith(
        "Already voted"
      );
      await movePastVotingDeadline(dao);
      await expect(dao.connect(stakeholder).payBeneficiary(1)).to.be.revertedWith(
        "Proposal did not pass"
      );
    });

    it("does not allow a proposal to be paid twice", async function () {
      await createProposal();
      await dao.connect(stakeholder).performVote(0, true);
      await movePastVotingDeadline(dao);
      await dao.connect(stakeholder).payBeneficiary(0);

      await expect(dao.connect(stakeholder).payBeneficiary(0)).to.be.revertedWith(
        "Proposal already paid"
      );
    });

    it("checks the current treasury balance at payout time", async function () {
      await makeStakeholder(stakeholder, "0.02");
      await makeStakeholder(secondStakeholder, "0.01");

      await dao
        .connect(stakeholder)
        .createProposal("Large", "Large proposal", beneficiary.address, ether("0.03"));
      await dao
        .connect(secondStakeholder)
        .createProposal("Small", "Small proposal", beneficiary.address, ether("0.005"));
      await dao.connect(stakeholder).performVote(0, true);
      await dao.connect(secondStakeholder).performVote(1, true);
      await movePastVotingDeadline(dao);
      await dao.connect(secondStakeholder).payBeneficiary(1);

      await expect(dao.connect(stakeholder).payBeneficiary(0)).to.be.revertedWith(
        "Insufficient DAO balance"
      );
    });
  });
});
