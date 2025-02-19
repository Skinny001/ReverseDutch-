const { expect } = require("chai");
const hre = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("ReverseAuction", function () {
  let reverseAuction, mockNFT;
  let owner, seller, buyer, addrs;
  let tokenId = 1;

  beforeEach(async function () {
    // Deploy mock NFT contract
    mockNFT = await hre.ethers.deployContract("MockNFT", ["MockNFT", "MNFT"]);
    console.log("MockNFT deployed at:", mockNFT.target);

    // Deploy ReverseAuction contract
    reverseAuction = await hre.ethers.deployContract("ReverseAuction");
    console.log("ReverseAuction deployed at:", reverseAuction.target);

    [owner, seller, buyer, ...addrs] = await hre.ethers.getSigners();
    console.log("Seller address:", seller.address);

    // Mint NFT to seller
    await mockNFT.connect(owner).mint(seller.address, tokenId);
    console.log("NFT minted to seller");

    // Approve the ReverseAuction contract for the token
    await mockNFT.connect(seller).approve(reverseAuction.target, tokenId);
    console.log("Approved ReverseAuction for token");
  });

  describe("Auction Creation", function () {
    it("Should create an auction successfully", async function () {
      const startPrice = hre.ethers.parseEther("1");
      const endPrice = hre.ethers.parseEther("0.5");
      const duration = 3600; // 1 hour

      // Create auction
      await expect(
        reverseAuction.connect(seller).createAuction(
          mockNFT.target,
          tokenId,
          startPrice,
          endPrice,
          duration
        )
      ).to.emit(reverseAuction, "AuctionCreated");

      const auction = await reverseAuction.auctions(0);
      expect(auction.seller).to.equal(seller.address);
      expect(auction.nftContract).to.equal(mockNFT.target);
      expect(auction.tokenId).to.equal(tokenId);
      expect(auction.startPrice).to.equal(startPrice);
      expect(auction.endPrice).to.equal(endPrice);
      expect(auction.active).to.be.true;
      expect(auction.finalized).to.be.false;
    });

    it("Should fail if start price is not greater than end price", async function () {
      const startPrice = hre.ethers.parseEther("1");
      const endPrice = hre.ethers.parseEther("1");
      const duration = 3600;

      await expect(
        reverseAuction.connect(seller).createAuction(
          mockNFT.target,
          tokenId,
          startPrice,
          endPrice,
          duration
        )
      ).to.be.revertedWith("Start price must be greater than end price");
    });

    it("Should fail if duration is 0", async function () {
      const startPrice = hre.ethers.parseEther("1");
      const endPrice = hre.ethers.parseEther("0.5");
      const duration = 0;

      await expect(
        reverseAuction.connect(seller).createAuction(
          mockNFT.target,
          tokenId,
          startPrice,
          endPrice,
          duration
        )
      ).to.be.revertedWith("Duration must be greater than 0");
    });
  });

  describe("Current Price Calculation", function () {
    let auctionId;
    const startPrice = hre.ethers.parseEther("1");
    const endPrice = hre.ethers.parseEther("0.5");
    const duration = 3600;

    beforeEach(async function () {
      await reverseAuction.connect(seller).createAuction(
        mockNFT.target,
        tokenId,
        startPrice,
        endPrice,
        duration
      );
      auctionId = 0;
    });

    it("Should return correct price at start", async function () {
      const currentPrice = await reverseAuction.getCurrentPrice(auctionId);
      expect(currentPrice).to.equal(startPrice);
    });

    it("Should return end price after auction end", async function () {
      await time.increase(duration + 1);
      const currentPrice = await reverseAuction.getCurrentPrice(auctionId);
      expect(currentPrice).to.equal(endPrice);
    });
  });

  describe("Buying NFT", function () {
    let auctionId;
    const startPrice = hre.ethers.parseEther("1");
    const endPrice = hre.ethers.parseEther("0.5");
    const duration = 3600;

    beforeEach(async function () {
      await reverseAuction.connect(seller).createAuction(
        mockNFT.target,
        tokenId,
        startPrice,
        endPrice,
        duration
      );
      auctionId = 0;
    });

    it("Should successfully buy NFT", async function () {
      await time.increase(duration / 2);
      const currentPrice = await reverseAuction.getCurrentPrice(auctionId);
      
      const sellerInitialBalance = await ethers.provider.getBalance(seller.address);
      
      await expect(
        reverseAuction.connect(buyer).buy(auctionId, { value: currentPrice })
      ).to.emit(reverseAuction, "AuctionFinalized");

      // Check NFT ownership
      expect(await mockNFT.ownerOf(tokenId)).to.equal(buyer.address);

      // Check seller received payment with tolerance for minor differences
      const sellerFinalBalance = await ethers.provider.getBalance(seller.address);
      const balanceDifference = sellerFinalBalance - sellerInitialBalance;
      
      // Define an acceptable margin of error (0.1% of current price)
      const marginOfError = currentPrice * BigInt(1) / BigInt(1000);
      const lowerBound = currentPrice - marginOfError;
      const upperBound = currentPrice + marginOfError;
      
      expect(balanceDifference >= lowerBound && balanceDifference <= upperBound).to.be.true,
        `Balance difference (${balanceDifference}) should be close to ${currentPrice}`;
    });
    it("Should refund excess payment", async function () {
      const currentPrice = await reverseAuction.getCurrentPrice(auctionId);
      const excess = ethers.parseEther("0.5");
      const buyerInitialBalance = await ethers.provider.getBalance(buyer.address);
      
      const tx = await reverseAuction.connect(buyer).buy(auctionId, { 
        value: currentPrice + excess 
      });
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const buyerFinalBalance = await ethers.provider.getBalance(buyer.address);
      const expectedBalance = buyerInitialBalance - currentPrice - gasUsed;
      
      // Allow for 0.1% variation in final balance
      const marginOfError = currentPrice * BigInt(1) / BigInt(1000);
      const lowerBound = expectedBalance - marginOfError;
      const upperBound = expectedBalance + marginOfError;
      
      expect(buyerFinalBalance >= lowerBound && buyerFinalBalance <= upperBound).to.be.true,
        `Final balance (${buyerFinalBalance}) should be close to expected (${expectedBalance})`;
    });
  });

  describe("Auction Cancellation", function () {
    let auctionId;

    beforeEach(async function () {
      await reverseAuction.connect(seller).createAuction(
        mockNFT.target,
        tokenId,
        hre.ethers.parseEther("1"),
        hre.ethers.parseEther("0.5"),
        3600
      );
      auctionId = 0;
    });

    it("Should allow seller to cancel auction", async function () {
      await reverseAuction.connect(seller).cancelAuction(auctionId);
      const auction = await reverseAuction.auctions(auctionId);
      expect(auction.active).to.be.false;
      expect(auction.finalized).to.be.true;
      expect(await mockNFT.ownerOf(tokenId)).to.equal(seller.address);
    });

    it("Should not allow non-seller to cancel auction", async function () {
      await expect(
        reverseAuction.connect(buyer).cancelAuction(auctionId)
      ).to.be.revertedWith("Only seller can cancel");
    });
  });

  describe("Auction Queries", function () {
    beforeEach(async function () {
      // Create multiple auctions
      await mockNFT.connect(owner).mint(seller.address, 2);
      await mockNFT.connect(owner).mint(seller.address, 3);

      await mockNFT.connect(seller).setApprovalForAll(reverseAuction.target, true);

      // Create 3 auctions
      for (let i = 1; i <= 3; i++) {
        await reverseAuction.connect(seller).createAuction(
          mockNFT.target,
          i,
          hre.ethers.parseEther("1"),
          hre.ethers.parseEther("0.5"),
          3600
        );
      }
    });

    it("Should return all auctions", async function () {
      const allAuctions = await reverseAuction.getAllAuctions();
      expect(allAuctions.length).to.equal(3);
    });

    it("Should return only active auctions", async function () {
      // Cancel one auction
      await reverseAuction.connect(seller).cancelAuction(0);

      const activeAuctions = await reverseAuction.getActiveAuctions();
      expect(activeAuctions.length).to.equal(2);

      // Verify all returned auctions are active
      activeAuctions.forEach((auction) => {
        expect(auction.active).to.be.true;
        expect(auction.finalized).to.be.false;
      });
    });
  });
});