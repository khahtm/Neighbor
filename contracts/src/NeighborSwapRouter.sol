// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * NeighborSwapRouter — a minimal exact-input single-hop router bound to one factory.
 *
 * Robinhood Chain testnet is a public sandbox: the factory that holds real liquidity (0x911b4000…)
 * has no publicly available router, so we deploy our own to route swaps against its pools. Pulls the
 * input token from the caller via transferFrom (caller must approve this router), calls the pool's
 * swap, and enforces a minimum output. NOT audited — testnet only.
 *
 * The funded pools are a SYNTHRA V3 fork (a Uniswap V3 fork): the swap ABI is identical, but the pool
 * invokes `synthraV3SwapCallback` on the caller (verified on-chain from the pool bytecode), NOT the
 * canonical `uniswapV3SwapCallback`. The callback below matches that name so the pool's payment
 * callback resolves — a Uniswap-named callback reverts with empty data.
 */
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address);
}

interface IUniswapV3Pool {
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

contract NeighborSwapRouter {
    IUniswapV3Factory public immutable factory;

    // Uniswap V3 sqrt-price bounds (inclusive limits are exclusive in swap()).
    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    // Transient state so the swap callback knows who pays + which pool is authorised.
    address private payer;
    address private activePool;

    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    constructor(address _factory) {
        factory = IUniswapV3Factory(_factory);
    }

    function exactInputSingle(ExactInputSingleParams calldata p) external returns (uint256 amountOut) {
        address pool = factory.getPool(p.tokenIn, p.tokenOut, p.fee);
        require(pool != address(0), "NO_POOL");

        bool zeroForOne = p.tokenIn < p.tokenOut;
        payer = msg.sender;
        activePool = pool;

        (int256 amount0, int256 amount1) = IUniswapV3Pool(pool).swap(
            p.recipient,
            zeroForOne,
            int256(p.amountIn),
            zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1,
            abi.encode(p.tokenIn)
        );

        payer = address(0);
        activePool = address(0);

        amountOut = uint256(-(zeroForOne ? amount1 : amount0));
        require(amountOut >= p.amountOutMinimum, "TOO_LITTLE_OUT");
    }

    function synthraV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        require(msg.sender == activePool && payer != address(0), "BAD_CALLBACK");
        address tokenIn = abi.decode(data, (address));
        uint256 amountToPay = amount0Delta > 0 ? uint256(amount0Delta) : uint256(amount1Delta);
        IERC20(tokenIn).transferFrom(payer, msg.sender, amountToPay);
    }
}
