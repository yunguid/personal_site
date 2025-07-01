// Complex number helper class
class Complex {
    constructor(real, imag) {
        this.real = real;
        this.imag = imag;
    }

    multiply(other) {
        return new Complex(
            this.real * other.real - this.imag * other.imag,
            this.real * other.imag + this.imag * other.real
        );
    }

    add(other) {
        return new Complex(
            this.real + other.real,
            this.imag + other.imag
        );
    }

    magnitudeSquared() {
        return this.real * this.real + this.imag * this.imag;
    }
}

export class JuliaSetGenerator {
    constructor(width, height) {
        // Device detection
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        
        // Adjust dimensions for mobile
        if (isMobile) {
            this.width = Math.floor(width * 0.6);
            this.height = Math.floor(height * 0.6);
        } else {
            this.width = width;
            this.height = height;
        }
        this.maxIterations = 50;
        this.time = 0;
        this.chars = ' .:-=+*#%@';
        this.centerText = "LUKE YOUNG";
        this.centerTextPos = {
            x: Math.floor((this.width - this.centerText.length) / 2),
            y: Math.floor(this.height / 2)
        };
    }

    mapToComplex(x, y) {
        const real = 3 * (x - this.width / 2) / this.width;
        const imag = 3 * (y - this.height / 2) / this.height;
        return new Complex(real, imag);
    }

    getJuliaParameters(t) {
        const scale = 0.7;
        return new Complex(
            scale * Math.cos(t * 0.1),
            scale * Math.sin(t * 0.1)
        );
    }

    generateFrame(mouseX = 0, mouseY = 0) {
        this.time += 0.03;
        const parameter = this.getJuliaParameters(this.time);
        let frame = '';

        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (y === this.centerTextPos.y && 
                    x >= this.centerTextPos.x && 
                    x < this.centerTextPos.x + this.centerText.length) {
                    const charIndex = Math.floor((x - this.centerTextPos.x) / 1);
                    frame += this.centerText[charIndex];
                    continue;
                }

                let c = this.mapToComplex(x + mouseX * 10, y + mouseY * 10);
                const iteration = this.calculatePoint(c, parameter);
                const charIndex = Math.floor((iteration / this.maxIterations) * (this.chars.length - 1));
                frame += this.chars[charIndex];
            }
            frame += '\n';
        }
        return frame;
    }

    calculatePoint(c, parameter) {
        let z = c;
        let iteration = 0;

        while (iteration < this.maxIterations && z.magnitudeSquared() < 4) {
            z = z.multiply(z).add(parameter);
            iteration++;
        }

        return iteration;
    }
} 