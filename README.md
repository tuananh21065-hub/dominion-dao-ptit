# DominionDAO - Smart Contract & React Web3 PTIT

Ứng dụng DAO tối giản cho bài thực hành PTIT: góp ETH vào quỹ chung, trở thành Stakeholder khi tổng góp đạt `0.01 ETH`, tạo proposal, biểu quyết trong `5 phút`, và giải ngân cho beneficiary nếu phiếu thuận lớn hơn phiếu phản đối.

Contract và frontend đều dùng dữ liệu blockchain thật. Project chỉ hỗ trợ Hardhat local (`chainId 31337`) và Ethereum Sepolia (`chainId 11155111`); không có cấu hình mainnet.

## Mốc A - hiện trạng và quyết định kỹ thuật

Repo mẫu được kiểm tra trước khi sửa. Repo chỉ có Hardhat/contract, chưa có React hoàn chỉnh. Bản mẫu có private key Sepolia hardcode trong cấu hình, payout chưa chặn trước deadline, và chống vote trùng bằng cách quét mảng. Bản triển khai này đã thay bằng:

- Hardhat `2.22.19`, Solidity `0.8.19`, OpenZeppelin `4.9.6`, ethers `5.7.2`.
- Không có private key trong source. Sepolia chỉ nhận `SEPOLIA_RPC_URL` và `PRIVATE_KEY` từ `.env` bị gitignore.
- Mapping `hasVoted[proposalId][voter]`, kiểm tra proposal tồn tại, title/description, beneficiary, amount và treasury balance.
- Payout chỉ chạy khi `block.timestamp >= votingDeadline`, thắng phiếu, chưa trả và treasury còn đủ ETH.
- Cập nhật state trước external call và dùng `ReentrancyGuard`.

## Cấu trúc

```text
contracts/DominionDAO.sol       # Smart contract
test/DominionDAO.test.js        # Test tự động Hardhat
scripts/deploy.js               # Deploy local/Sepolia, ghi deployments/<network>.json
scripts/sync-abi.js              # Đồng bộ ABI từ artifact sang React
frontend/src/App.jsx            # React UI + trạng thái giao dịch
frontend/src/lib/contract.js     # ethers provider, ABI, format/error helpers
frontend/src/styles.css          # UI responsive
```

## Chạy và kiểm thử local

Yêu cầu Node.js `>=18`. Node `24.16.0` đã được dùng để kiểm tra trong workspace này.

Terminal 1:

```bash
npm install
npm run compile
npm test
npm run test:coverage
```

Terminal 2:

```bash
npm run node
```

Terminal 3:

```bash
npm run deploy:local
npm run sync:abi
```

Lệnh local đã tạo contract tại địa chỉ mẫu:

```text
0x5FbDB2315678afecb367f032d93F642f64180aa3
```

Copy `frontend/.env.local.example` thành `frontend/.env.local`, điền địa chỉ local ở trên, sau đó:

```bash
cd frontend
npm install
npm run dev
```

Mở `http://127.0.0.1:5173/`. Nếu muốn ký giao dịch local qua MetaMask, thêm mạng:

```text
Network name: Local Hardhat
RPC URL: http://127.0.0.1:8545
Chain ID: 31337
Currency symbol: ETH
```

Hardhat node in private test accounts trong terminal để test local. Chỉ dùng các khóa đó trên chain local; tuyệt đối không nhập chúng vào Sepolia hoặc mainnet.

## Cấu hình và triển khai Sepolia

Sau khi preflight PASS và người dùng xác nhận, DominionDAO đã được deploy trên Sepolia. Không có transaction contribute, vote hoặc payout nào được thực hiện.

Thông tin triển khai:

```text
Contract: 0x20e4E3B1955110d2fad1239F6f48e8ac053c3733
Transaction: 0xc78df005a6e4b10c58c446a7d092ef0a0b1fed7684a4560a1927ebb6227e483f
Chain ID: 11155111
Block: 11898998
Gas used: 14175156
Deployment fee: 0.014175156 ETH
Runtime bytecode: 8888 bytes
```

1. Tạo `.env` từ `.env.example` và điền RPC Sepolia cùng private key của một deployer wallet chỉ có ETH testnet. Không commit file này.
2. Kiểm tra compile/test local:

   ```bash
   npm run compile
   npm test
   ```

3. Chạy preflight read-only trước khi xin xác nhận deploy. Lệnh này kiểm tra RPC có trả đúng chain ID `11155111`, in địa chỉ công khai của deployer và ước tính gas; không in private key và không gửi transaction:

   ```bash
   npm run preflight:sepolia
   ```

4. Sau khi preflight đạt và người dùng xác nhận được phép deploy Sepolia, chạy:

   ```bash
   npm run deploy:sepolia
   ```

   Script sẽ in địa chỉ contract và ghi metadata vào `deployments/sepolia.json`.

5. Sau khi có địa chỉ contract đã xác nhận, tạo `frontend/.env.local` cho Sepolia:

   ```dotenv
   VITE_CONTRACT_ADDRESS=0xCONFIRMED_SEPOLIA_CONTRACT_ADDRESS
   VITE_CHAIN_ID=11155111
   VITE_NETWORK_NAME=Sepolia
   VITE_EXPLORER_BASE_URL=https://sepolia.etherscan.io
   ```

6. Build frontend:

   ```bash
   cd frontend
   npm run build
   ```

7. Verify contract bằng Etherscan API V2:

   ```bash
   npm run verify:sepolia
   ```

   Script dùng Standard JSON Input từ Hardhat build-info. Hiện verify đang chờ thay `ETHERSCAN_API_KEY` hợp lệ; API hiện trả `Invalid API Key (#err2)`.

Không sử dụng deployer key có trong repo mẫu. Không gửi ETH thật, không chạy mainnet, và không đổi chain sang mainnet trong MetaMask.

## Kịch bản demo PTIT

1. Kết nối 3-5 ví MetaMask vào cùng một contract và cùng chain.
2. Ví A góp `0.005 ETH`, kiểm tra vẫn là Contributor/Visitor.
3. Ví A góp thêm `0.005 ETH`, kiểm tra quyền chuyển thành Stakeholder.
4. Ví A tạo proposal với beneficiary là ví B, amount nhỏ hơn số dư DAO.
5. Ví A và các Stakeholder khác chọn `Đồng ý` hoặc `Phản đối`; mỗi ví chỉ vote một lần.
6. Khi còn hạn, nút `Thanh toán` không được hoạt động.
7. Sau hơn 5 phút, nếu phiếu thuận > phiếu phản đối, một Stakeholder bấm `Thanh toán`.
8. Kiểm tra trạng thái `Đã thanh toán`, số dư quỹ giảm đúng amount, và mở transaction trên Sepolia Etherscan để kiểm tra beneficiary nhận ETH.

## Ma trận kiểm thử đã chạy

Lệnh `npm test`: **14 passing**.

| Nhóm | Kết quả |
| --- | --- |
| Góp 0 ETH bị từ chối | PASS |
| Dưới 0.01 ETH chưa là Stakeholder | PASS |
| Đủ 0.01 ETH được cấp quyền | PASS |
| Không đủ quyền không tạo/vote | PASS |
| Beneficiary zero, amount zero/quá quỹ | PASS |
| Title/description rỗng | PASS |
| Một ví không vote hai lần | PASS |
| Vote sau deadline | PASS |
| Payout trước deadline | PASS |
| Proposal thắng được trả sau deadline | PASS |
| Proposal hòa/thua không được trả | PASS |
| Không payout hai lần | PASS |
| Quỹ không đủ tại thời điểm payout | PASS |
| Beneficiary nhận đúng ETH và daoBalance giảm đúng | PASS |

Coverage hiện tại: `89.8%` statements, `86.96%` branches, `76.47%` functions, `88.89%` lines.

## Lưu ý dependency

Bộ Hardhat/Waffle được cố định theo hệ ethers v5 để tương thích với Solidity `0.8.19` và OpenZeppelin `4.9.6`. `npm install` hiện báo một số cảnh báo audit từ dependency gián tiếp cũ của Waffle/Hardhat; không chạy `npm audit fix --force` vì có thể phá vỡ bộ phiên bản của bài thực hành.

## Trạng thái bàn giao

- Mốc A: hoàn tất.
- Mốc B: hoàn tất, compile/test/coverage đã chạy.
- Mốc C: hoàn tất, `frontend npm run build` đã chạy và UI local đã được kiểm tra trực quan.
- Mốc D: hoàn tất; đã deploy DominionDAO lên Sepolia, xác nhận receipt/bytecode và đồng bộ frontend.
- Mốc E: chưa bắt đầu; verify Etherscan còn chờ API key hợp lệ, sau đó mới thực hiện kịch bản contribute/vote/payout theo hướng dẫn riêng.
