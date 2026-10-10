"""Small dense linear algebra for Tier R kinematics (stdlib, deterministic, float64).

Matrices are lists of rows. Sizes are those of crease patterns (tens to a few hundred unknowns),
so plain O(n³) routines are adequate; every loop runs in a fixed order and sums with
`math.fsum`, so results are bit-reproducible.
"""

from __future__ import annotations

import math

Matrix = list[list[float]]
Vector = list[float]


def mat_t(a: Matrix, cols: int | None = None) -> Matrix:
    """Transpose (`cols` gives the width of an empty-row matrix)."""
    if not a:
        return [[] for _ in range(cols or 0)]
    return [list(c) for c in zip(*a, strict=True)]


def mat_vec(a: Matrix, x: Vector) -> Vector:
    return [math.fsum(r * v for r, v in zip(row, x, strict=True)) for row in a]


def gram(a: Matrix, n: int) -> Matrix:
    """AᵀA (n × n) for an m × n matrix A."""
    cols = mat_t(a, n)
    return [[math.fsum(x * y for x, y in zip(cols[i], cols[j], strict=True)) for j in range(n)]
            for i in range(n)]


def cholesky_solve(a: Matrix, b: Vector) -> Vector:
    """Solve A x = b for a symmetric positive-definite A (raises ValueError otherwise)."""
    n = len(a)
    low = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1):
            s = a[i][j] - math.fsum(low[i][k] * low[j][k] for k in range(j))
            if i == j:
                if s <= 0.0:
                    raise ValueError("matrix is not positive definite")
                low[i][i] = math.sqrt(s)
            else:
                low[i][j] = s / low[j][j]
    y = [0.0] * n
    for i in range(n):
        y[i] = (b[i] - math.fsum(low[i][k] * y[k] for k in range(i))) / low[i][i]
    x = [0.0] * n
    for i in reversed(range(n)):
        x[i] = (y[i] - math.fsum(low[k][i] * x[k] for k in range(i + 1, n))) / low[i][i]
    return x


def damped_solve(c: Matrix, r: Vector, n: int, lam: float) -> Vector:
    """Damped least squares: argmin |C x − r|² + λ²|x|² = (CᵀC + λ²I)⁻¹ Cᵀ r (rsE §a2)."""
    if n == 0:
        return []
    a = gram(c, n)
    for i in range(n):
        a[i][i] += lam * lam
    ct = mat_t(c, n)
    return cholesky_solve(a, [math.fsum(x * y for x, y in zip(col, r, strict=True))
                              for col in ct])


def svd(a: Matrix, n: int, sweeps: int = 80) -> tuple[Vector, Matrix, Matrix]:
    """Thin SVD by one-sided Jacobi (Hestenes) on the columns of an m × n matrix.

    Returns (σ, U, V) with A·V[:, k] = σ_k·U[:, k]; σ descending; V is n × n orthogonal (rows
    are coordinates, columns are the right singular vectors). Columns with σ_k = 0 have a zero
    U column. Deterministic: fixed sweep order, ties broken by column index.
    """
    m = len(a)
    cols = [[a[i][j] for i in range(m)] for j in range(n)]
    v = [[1.0 if i == j else 0.0 for j in range(n)] for i in range(n)]
    vcols = [[v[i][j] for i in range(n)] for j in range(n)]
    for _ in range(sweeps):
        off = 0.0
        for p in range(n - 1):
            for q in range(p + 1, n):
                x, y = cols[p], cols[q]
                alpha = math.fsum(t * t for t in x)
                beta = math.fsum(t * t for t in y)
                gamma = math.fsum(s * t for s, t in zip(x, y, strict=True))
                if gamma == 0.0 or alpha == 0.0 or beta == 0.0 \
                        or abs(gamma) <= 1e-15 * math.sqrt(alpha) * math.sqrt(beta):
                    continue
                off = max(off, abs(gamma) / (math.sqrt(alpha) * math.sqrt(beta)))
                zeta = (beta - alpha) / (2.0 * gamma)
                t = math.copysign(1.0, zeta) / (abs(zeta) + math.sqrt(1.0 + zeta * zeta))
                c = 1.0 / math.sqrt(1.0 + t * t)
                s = c * t
                cols[p] = [c * u - s * w for u, w in zip(x, y, strict=True)]
                cols[q] = [s * u + c * w for u, w in zip(x, y, strict=True)]
                vp, vq = vcols[p], vcols[q]
                vcols[p] = [c * u - s * w for u, w in zip(vp, vq, strict=True)]
                vcols[q] = [s * u + c * w for u, w in zip(vp, vq, strict=True)]
        if off < 1e-15:
            break
    sig = [math.sqrt(math.fsum(t * t for t in col)) for col in cols]
    order = sorted(range(n), key=lambda k: (-sig[k], k))
    sigma = [sig[k] for k in order]
    ucols = [[t / sig[k] for t in cols[k]] if sig[k] > 0.0 else [0.0] * m for k in order]
    vsorted = [vcols[k] for k in order]
    return sigma, mat_t(ucols, m) if m else [], mat_t(vsorted, n)


def pinv_split(a: Matrix, n: int, rtol: float = 1e-9
               ) -> tuple[Vector, Matrix, Matrix, list[Vector]]:
    """SVD pieces for min-norm solves: (σ kept, U kept cols, V kept cols, null-space basis).

    Singular values ≤ rtol·σ_max (or all, when σ_max = 0) span the null space."""
    sigma, u, v = svd(a, n)
    top = sigma[0] if sigma else 0.0
    keep = [k for k, s in enumerate(sigma) if top > 0.0 and s > rtol * top]
    null = [[v[i][k] for i in range(n)] for k in range(n) if k not in keep]
    ukeep = [[u[i][k] for k in keep] for i in range(len(u))]
    vkeep = [[v[i][k] for k in keep] for i in range(n)]
    return [sigma[k] for k in keep], ukeep, vkeep, null


def min_norm_solve(pieces: tuple[Vector, Matrix, Matrix, list[Vector]], b: Vector) -> Vector:
    """x = A⁺ b from `pinv_split` pieces (the least-squares solution of least norm)."""
    sig, u, v, _ = pieces
    coef = [math.fsum(u[i][k] * b[i] for i in range(len(b))) / s for k, s in enumerate(sig)]
    return [math.fsum(v[i][k] * coef[k] for k in range(len(sig))) for i in range(len(v))]
