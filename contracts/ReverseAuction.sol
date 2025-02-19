// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract ReverseAuction is ReentrancyGuard {
    struct Auction {
        address seller;
        address nftContract;
        uint256 tokenId;
        uint256 startPrice;
        uint256 endPrice;
        uint256 startTime;
        uint256 endTime;
        bool active;
        bool finalized;
    }

    mapping(uint256 => Auction) public auctions;
    uint256 public auctionCounter;

    event AuctionCreated(
        uint256 indexed auctionId,
        address indexed seller,
        address indexed nftContract,
        uint256 tokenId,
        uint256 startPrice,
        uint256 endPrice,
        uint256 startTime,
        uint256 endTime
    );

    event AuctionFinalized(
        uint256 indexed auctionId,
        address indexed buyer,
        uint256 finalPrice
    );

    function createAuction(
        address _nftContract,
        uint256 _tokenId,
        uint256 _startPrice,
        uint256 _endPrice,
        uint256 _duration
    ) external returns (uint256) {
        require(_startPrice > _endPrice, "Start price must be greater than end price");
        require(_duration > 0, "Duration must be greater than 0");

        IERC721 nft = IERC721(_nftContract);
        require(nft.ownerOf(_tokenId) == msg.sender, "Not token owner");
        require(nft.isApprovedForAll(msg.sender, address(this)) || 
                nft.getApproved(_tokenId) == address(this), 
                "Contract not approved");

        uint256 auctionId = auctionCounter++;
        uint256 startTime = block.timestamp;
        uint256 endTime = startTime + _duration;

        auctions[auctionId] = Auction({
            seller: msg.sender,
            nftContract: _nftContract,
            tokenId: _tokenId,
            startPrice: _startPrice,
            endPrice: _endPrice,
            startTime: startTime,
            endTime: endTime,
            active: true,
            finalized: false
        });

        nft.transferFrom(msg.sender, address(this), _tokenId);

        emit AuctionCreated(
            auctionId,
            msg.sender,
            _nftContract,
            _tokenId,
            _startPrice,
            _endPrice,
            startTime,
            endTime
        );

        return auctionId;
    }

    function getCurrentPrice(uint256 _auctionId) public view returns (uint256) {
        Auction storage auction = auctions[_auctionId];
        require(auction.active, "Auction is not active");
        
        if (block.timestamp >= auction.endTime) {
            return auction.endPrice;
        }

        uint256 elapsed = block.timestamp - auction.startTime;
        uint256 duration = auction.endTime - auction.startTime;
        uint256 priceDiff = auction.startPrice - auction.endPrice;
        
        return auction.startPrice - (priceDiff * elapsed / duration);
    }

    function buy(uint256 _auctionId) external payable nonReentrant {
        Auction storage auction = auctions[_auctionId];
        require(auction.active, "Auction is not active");
        require(!auction.finalized, "Auction is already finalized");
        require(block.timestamp <= auction.endTime, "Auction has ended");

        uint256 currentPrice = getCurrentPrice(_auctionId);
        require(msg.value >= currentPrice, "Insufficient payment");

        auction.active = false;
        auction.finalized = true;

        IERC721(auction.nftContract).transferFrom(address(this), msg.sender, auction.tokenId);

        uint256 excess = msg.value - currentPrice;
        if (excess > 0) {
            payable(msg.sender).transfer(excess);
        }
        payable(auction.seller).transfer(currentPrice);

        emit AuctionFinalized(_auctionId, msg.sender, currentPrice);
    }

    function cancelAuction(uint256 _auctionId) external {
        Auction storage auction = auctions[_auctionId];
        require(msg.sender == auction.seller, "Only seller can cancel");
        require(auction.active, "Auction is not active");
        require(!auction.finalized, "Auction is already finalized");

        auction.active = false;
        auction.finalized = true;

        IERC721(auction.nftContract).transferFrom(address(this), auction.seller, auction.tokenId);
    }

    function getAllAuctions() external view returns (Auction[] memory) {
        Auction[] memory allAuctions = new Auction[](auctionCounter);
        for (uint256 i = 0; i < auctionCounter; i++) {
            allAuctions[i] = auctions[i];
        }
        return allAuctions;
    }

    function getActiveAuctions() external view returns (Auction[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < auctionCounter; i++) {
            if (auctions[i].active && !auctions[i].finalized) {
                activeCount++;
            }
        }

        Auction[] memory activeAuctions = new Auction[](activeCount);
        uint256 currentIndex = 0;

        for (uint256 i = 0; i < auctionCounter; i++) {
            if (auctions[i].active && !auctions[i].finalized) {
                activeAuctions[currentIndex] = auctions[i];
                currentIndex++;
            }
        }

        return activeAuctions;
    }
}