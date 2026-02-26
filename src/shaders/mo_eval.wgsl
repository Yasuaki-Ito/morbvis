// MO Evaluation Compute Shader
// Evaluates psi(r) = sum_mu C_mu * chi_mu(r) for each grid point

struct GridParams {
    origin_x: f32,
    origin_y: f32,
    origin_z: f32,
    spacing: f32,
    nx: u32,
    ny: u32,
    nz: u32,
    n_basis: u32,
    n_shells: u32,
    use_spherical_d: u32,
    use_spherical_f: u32,
    _pad: u32,
}

struct ShellInfo {
    center_x: f32,
    center_y: f32,
    center_z: f32,
    shell_type: u32,  // 0=s, 1=p, 2=d, 3=f
    prim_start: u32,
    prim_count: u32,
    basis_start: u32,
    _pad: u32,
}

struct PrimData {
    exponent: f32,
    coefficient: f32,
}

@group(0) @binding(0) var<uniform> params: GridParams;
@group(0) @binding(1) var<storage, read> shells: array<ShellInfo>;
@group(0) @binding(2) var<storage, read> primitives: array<PrimData>;
@group(0) @binding(3) var<storage, read> mo_coeffs: array<f32>;
@group(0) @binding(4) var<storage, read_write> field: array<f32>;

const ANG_TO_BOHR: f32 = 1.0 / 0.529177249;
const PI: f32 = 3.14159265358979;

// Double factorial: (2n-1)!! for n = 0,1,2,3
// df(-1)=1, df(1)=1, df(3)=3*1=3, df(5)=5*3*1=15
fn double_factorial(n: i32) -> f32 {
    if (n <= 0) { return 1.0; }
    var result: f32 = 1.0;
    var i: i32 = n;
    loop {
        if (i < 1) { break; }
        result *= f32(i);
        i -= 2;
    }
    return result;
}

// Normalization for primitive Gaussian x^l * y^m * z^n * exp(-alpha*r^2)
fn primitive_norm(alpha: f32, l: i32, m: i32, n: i32) -> f32 {
    let big_l = l + m + n;
    return pow(2.0 * alpha / PI, 0.75)
         * pow(4.0 * alpha, f32(big_l) / 2.0)
         / sqrt(double_factorial(2*l - 1) * double_factorial(2*m - 1) * double_factorial(2*n - 1));
}

// Evaluate contracted s shell
fn eval_s(shell_idx: u32, r2: f32) -> f32 {
    let shell = shells[shell_idx];
    var value: f32 = 0.0;
    let n = primitive_norm(1.0, 0, 0, 0); // placeholder, computed per primitive below
    for (var p = 0u; p < shell.prim_count; p++) {
        let prim = primitives[shell.prim_start + p];
        let norm = primitive_norm(prim.exponent, 0, 0, 0);
        value += prim.coefficient * norm * exp(-prim.exponent * r2);
    }
    return value;
}

// Evaluate contracted p shell, add to mo_value
fn eval_p(shell_idx: u32, dx: f32, dy: f32, dz: f32, r2: f32, basis_start: u32, mo_value: ptr<function, f32>) {
    let shell = shells[shell_idx];
    var radial: f32 = 0.0;
    for (var p = 0u; p < shell.prim_count; p++) {
        let prim = primitives[shell.prim_start + p];
        let norm = primitive_norm(prim.exponent, 1, 0, 0);
        radial += prim.coefficient * norm * exp(-prim.exponent * r2);
    }
    *mo_value += mo_coeffs[basis_start]     * radial * dx;  // px
    *mo_value += mo_coeffs[basis_start + 1u] * radial * dy;  // py
    *mo_value += mo_coeffs[basis_start + 2u] * radial * dz;  // pz
}

// Evaluate contracted d shell (Cartesian, 6 components)
fn eval_d_cartesian(shell_idx: u32, dx: f32, dy: f32, dz: f32, r2: f32, basis_start: u32, mo_value: ptr<function, f32>) {
    let shell = shells[shell_idx];
    var radial_xx: f32 = 0.0;
    var radial_xy: f32 = 0.0;
    for (var p = 0u; p < shell.prim_count; p++) {
        let prim = primitives[shell.prim_start + p];
        let exp_val = exp(-prim.exponent * r2);
        radial_xx += prim.coefficient * primitive_norm(prim.exponent, 2, 0, 0) * exp_val;
        radial_xy += prim.coefficient * primitive_norm(prim.exponent, 1, 1, 0) * exp_val;
    }
    *mo_value += mo_coeffs[basis_start]      * radial_xx * dx * dx; // xx
    *mo_value += mo_coeffs[basis_start + 1u]  * radial_xx * dy * dy; // yy
    *mo_value += mo_coeffs[basis_start + 2u]  * radial_xx * dz * dz; // zz
    *mo_value += mo_coeffs[basis_start + 3u]  * radial_xy * dx * dy; // xy
    *mo_value += mo_coeffs[basis_start + 4u]  * radial_xy * dx * dz; // xz
    *mo_value += mo_coeffs[basis_start + 5u]  * radial_xy * dy * dz; // yz
}

// Evaluate contracted d shell (spherical, 5 components)
fn eval_d_spherical(shell_idx: u32, dx: f32, dy: f32, dz: f32, r2: f32, basis_start: u32, mo_value: ptr<function, f32>) {
    let shell = shells[shell_idx];
    var radial_xx: f32 = 0.0;
    var radial_xy: f32 = 0.0;
    for (var p = 0u; p < shell.prim_count; p++) {
        let prim = primitives[shell.prim_start + p];
        let exp_val = exp(-prim.exponent * r2);
        radial_xx += prim.coefficient * primitive_norm(prim.exponent, 2, 0, 0) * exp_val;
        radial_xy += prim.coefficient * primitive_norm(prim.exponent, 1, 1, 0) * exp_val;
    }

    let xx = radial_xx * dx * dx;
    let yy = radial_xx * dy * dy;
    let zz = radial_xx * dz * dz;
    let xy = radial_xy * dx * dy;
    let xz = radial_xy * dx * dz;
    let yz = radial_xy * dy * dz;

    let s3 = sqrt(3.0);
    *mo_value += mo_coeffs[basis_start]      * (zz - 0.5 * (xx + yy));    // d0
    *mo_value += mo_coeffs[basis_start + 1u]  * (s3 * xz);                 // d+1
    *mo_value += mo_coeffs[basis_start + 2u]  * (s3 * yz);                 // d-1
    *mo_value += mo_coeffs[basis_start + 3u]  * (s3 * 0.5 * (xx - yy));    // d+2
    *mo_value += mo_coeffs[basis_start + 4u]  * (s3 * xy);                 // d-2
}

// Evaluate contracted f shell (Cartesian, 10 components)
fn eval_f_cartesian(shell_idx: u32, dx: f32, dy: f32, dz: f32, r2: f32, basis_start: u32, mo_value: ptr<function, f32>) {
    let shell = shells[shell_idx];
    var radial_300: f32 = 0.0;
    var radial_210: f32 = 0.0;
    var radial_111: f32 = 0.0;
    for (var p = 0u; p < shell.prim_count; p++) {
        let prim = primitives[shell.prim_start + p];
        let exp_val = exp(-prim.exponent * r2);
        radial_300 += prim.coefficient * primitive_norm(prim.exponent, 3, 0, 0) * exp_val;
        radial_210 += prim.coefficient * primitive_norm(prim.exponent, 2, 1, 0) * exp_val;
        radial_111 += prim.coefficient * primitive_norm(prim.exponent, 1, 1, 1) * exp_val;
    }
    *mo_value += mo_coeffs[basis_start]      * radial_300 * dx * dx * dx; // xxx
    *mo_value += mo_coeffs[basis_start + 1u]  * radial_300 * dy * dy * dy; // yyy
    *mo_value += mo_coeffs[basis_start + 2u]  * radial_300 * dz * dz * dz; // zzz
    *mo_value += mo_coeffs[basis_start + 3u]  * radial_210 * dx * dx * dy; // xxy
    *mo_value += mo_coeffs[basis_start + 4u]  * radial_210 * dx * dx * dz; // xxz
    *mo_value += mo_coeffs[basis_start + 5u]  * radial_210 * dx * dy * dy; // xyy
    *mo_value += mo_coeffs[basis_start + 6u]  * radial_210 * dy * dy * dz; // yyz
    *mo_value += mo_coeffs[basis_start + 7u]  * radial_210 * dx * dz * dz; // xzz
    *mo_value += mo_coeffs[basis_start + 8u]  * radial_210 * dy * dz * dz; // yzz
    *mo_value += mo_coeffs[basis_start + 9u]  * radial_111 * dx * dy * dz; // xyz
}

// Evaluate contracted f shell (spherical, 7 components)
fn eval_f_spherical(shell_idx: u32, dx: f32, dy: f32, dz: f32, r2: f32, basis_start: u32, mo_value: ptr<function, f32>) {
    let shell = shells[shell_idx];
    var radial_300: f32 = 0.0;
    var radial_210: f32 = 0.0;
    var radial_111: f32 = 0.0;
    for (var p = 0u; p < shell.prim_count; p++) {
        let prim = primitives[shell.prim_start + p];
        let exp_val = exp(-prim.exponent * r2);
        radial_300 += prim.coefficient * primitive_norm(prim.exponent, 3, 0, 0) * exp_val;
        radial_210 += prim.coefficient * primitive_norm(prim.exponent, 2, 1, 0) * exp_val;
        radial_111 += prim.coefficient * primitive_norm(prim.exponent, 1, 1, 1) * exp_val;
    }

    let xxx = radial_300 * dx * dx * dx;
    let yyy = radial_300 * dy * dy * dy;
    let zzz = radial_300 * dz * dz * dz;
    let xxy = radial_210 * dx * dx * dy;
    let xxz = radial_210 * dx * dx * dz;
    let xyy = radial_210 * dx * dy * dy;
    let yyz = radial_210 * dy * dy * dz;
    let xzz = radial_210 * dx * dz * dz;
    let yzz = radial_210 * dy * dz * dz;
    let xyz = radial_111 * dx * dy * dz;

    let s6  = sqrt(6.0);
    let s10 = sqrt(10.0);
    let s15 = sqrt(15.0);

    *mo_value += mo_coeffs[basis_start]      * (zzz - 1.5 * (xxz + yyz));              // f0
    *mo_value += mo_coeffs[basis_start + 1u]  * (s6 / 4.0 * (4.0 * xzz - xxx - xyy));   // f+1
    *mo_value += mo_coeffs[basis_start + 2u]  * (s6 / 4.0 * (4.0 * yzz - xxy - yyy));   // f-1
    *mo_value += mo_coeffs[basis_start + 3u]  * (s15 / 2.0 * (xxz - yyz));               // f+2
    *mo_value += mo_coeffs[basis_start + 4u]  * (s15 * xyz);                              // f-2
    *mo_value += mo_coeffs[basis_start + 5u]  * (s10 / 4.0 * (xxx - 3.0 * xyy));         // f+3
    *mo_value += mo_coeffs[basis_start + 6u]  * (s10 / 4.0 * (3.0 * xxy - yyy));         // f-3
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    let total = params.nx * params.ny * params.nz;
    if (idx >= total) {
        return;
    }

    // Recover 3D index
    let ix = idx % params.nx;
    let iy = (idx / params.nx) % params.ny;
    let iz = idx / (params.nx * params.ny);

    // World coordinate
    let px = params.origin_x + f32(ix) * params.spacing;
    let py = params.origin_y + f32(iy) * params.spacing;
    let pz = params.origin_z + f32(iz) * params.spacing;

    var mo_value: f32 = 0.0;

    for (var s = 0u; s < params.n_shells; s++) {
        let shell = shells[s];
        let dx = (px - shell.center_x) * ANG_TO_BOHR;
        let dy = (py - shell.center_y) * ANG_TO_BOHR;
        let dz = (pz - shell.center_z) * ANG_TO_BOHR;
        let r2 = dx * dx + dy * dy + dz * dz;

        if (shell.shell_type == 0u) {
            // s shell
            mo_value += mo_coeffs[shell.basis_start] * eval_s(s, r2);
        } else if (shell.shell_type == 1u) {
            // p shell
            eval_p(s, dx, dy, dz, r2, shell.basis_start, &mo_value);
        } else if (shell.shell_type == 2u) {
            // d shell
            if (params.use_spherical_d != 0u) {
                eval_d_spherical(s, dx, dy, dz, r2, shell.basis_start, &mo_value);
            } else {
                eval_d_cartesian(s, dx, dy, dz, r2, shell.basis_start, &mo_value);
            }
        } else if (shell.shell_type == 3u) {
            // f shell
            if (params.use_spherical_f != 0u) {
                eval_f_spherical(s, dx, dy, dz, r2, shell.basis_start, &mo_value);
            } else {
                eval_f_cartesian(s, dx, dy, dz, r2, shell.basis_start, &mo_value);
            }
        }
    }

    field[iz * params.ny * params.nx + iy * params.nx + ix] = mo_value;
}
