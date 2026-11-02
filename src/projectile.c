/**
 * projectile.c
 * Core physics calculation engine for projectile motion.
 * Designed to be compiled to WebAssembly via Emscripten.
 *
 * All functions are pure, taking numerical values and pointers for output.
 * No scanf/printf or standard I/O used to maintain zero-overhead WebAssembly.
 */

#include <math.h>
#include <stddef.h>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

/**
 * Validates input parameters for projectile motion.
 * Returns 1 if valid, 0 if invalid.
 */
static int validate_inputs(double v0, double angle_deg, double h0, double g) {
    if (v0 < 0.0) return 0;
    if (angle_deg < 0.0 || angle_deg > 90.0) return 0;
    if (h0 < 0.0) return 0;
    if (g <= 0.0) return 0;
    return 1;
}

/**
 * Computes all key kinematic values of the trajectory.
 * 
 * Output array layout (out must have space for at least 8 doubles):
 *   out[0]: vx (horizontal velocity, m/s)
 *   out[1]: vy (initial vertical velocity, m/s)
 *   out[2]: time_to_peak (s)
 *   out[3]: max_height (m)
 *   out[4]: time_of_flight (s)
 *   out[5]: range (m)
 *   out[6]: impact_speed (m/s)
 *   out[7]: impact_angle (degrees below horizontal)
 *
 * Returns:
 *   0 on success
 *  -1 on validation error or NULL output pointer
 */
EMSCRIPTEN_KEEPALIVE
int compute(double v0, double angle_deg, double h0, double g, double* out) {
    if (!out) {
        return -1;
    }

    if (!validate_inputs(v0, angle_deg, h0, g)) {
        for (int i = 0; i < 8; i++) {
            out[i] = 0.0;
        }
        return -1;
    }

    double angle_rad = angle_deg * (M_PI / 180.0);
    double vx = v0 * cos(angle_rad);
    double vy = v0 * sin(angle_rad);

    // Peak calculation
    // At apex, vertical velocity vy(t) = vy - g*t = 0 => t_peak = vy / g
    double time_to_peak = vy / g;
    if (time_to_peak < 0.0) {
        time_to_peak = 0.0;
    }

    // Maximum height above the ground
    // y_max = h0 + vy*t_peak - 0.5*g*t_peak^2 = h0 + (vy^2)/(2*g)
    double max_height = h0 + (vy * vy) / (2.0 * g);

    // Time of flight
    // y(t) = h0 + vy*t - 0.5*g*t^2 = 0
    // Using standard quadratic solution: t = (vy + sqrt(vy^2 + 2*g*h0)) / g
    double discriminant = (vy * vy) + (2.0 * g * h0);
    if (discriminant < 0.0) {
        discriminant = 0.0;
    }
    double time_of_flight = (vy + sqrt(discriminant)) / g;
    if (time_of_flight < 0.0) {
        time_of_flight = 0.0;
    }

    // Total horizontal range
    double range = vx * time_of_flight;

    // Impact velocities
    double vx_impact = vx;
    double vy_impact = vy - (g * time_of_flight); // Negative downward velocity

    // Impact speed: sqrt(vx^2 + vy_impact^2) = sqrt(v0^2 + 2*g*h0) by conservation of energy
    double impact_speed = sqrt((vx_impact * vx_impact) + (vy_impact * vy_impact));

    // Impact angle (in degrees, angle of landing vector relative to horizontal)
    double impact_angle = 0.0;
    if (impact_speed > 1e-9) {
        impact_angle = atan2(fabs(vy_impact), fabs(vx_impact)) * (180.0 / M_PI);
    }

    // Populate output array
    out[0] = vx;
    out[1] = vy;
    out[2] = time_to_peak;
    out[3] = max_height;
    out[4] = time_of_flight;
    out[5] = range;
    out[6] = impact_speed;
    out[7] = impact_angle;

    return 0;
}

/**
 * Calculates projectile (x, y) coordinates at a specific time t.
 *
 * Parameters:
 *   v0, angle_deg, h0, g: Initial parameters
 *   t: Query time (seconds)
 *   x, y: Output pointers for coordinates (meters)
 *
 * Returns:
 *   0 on success
 *  -1 on validation error or NULL pointers
 */
EMSCRIPTEN_KEEPALIVE
int position(double v0, double angle_deg, double h0, double g, double t, double* x, double* y) {
    if (!x || !y) {
        return -1;
    }

    if (!validate_inputs(v0, angle_deg, h0, g)) {
        *x = 0.0;
        *y = 0.0;
        return -1;
    }

    if (t <= 0.0) {
        *x = 0.0;
        *y = h0;
        return 0;
    }

    double angle_rad = angle_deg * (M_PI / 180.0);
    double vx = v0 * cos(angle_rad);
    double vy = v0 * sin(angle_rad);

    double discriminant = (vy * vy) + (2.0 * g * h0);
    if (discriminant < 0.0) {
        discriminant = 0.0;
    }
    double time_of_flight = (vy + sqrt(discriminant)) / g;

    if (t >= time_of_flight) {
        *x = vx * time_of_flight;
        *y = 0.0;
        return 0;
    }

    *x = vx * t;
    *y = h0 + (vy * t) - (0.5 * g * t * t);
    if (*y < 0.0) {
        *y = 0.0;
    }

    return 0;
}
