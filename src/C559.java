import java.math.BigInteger;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Scanner;

public class C559 {

	static class Pair {
		public int i;
		public int j;

		public Pair(int x, int y) {
			// TODO Auto-generated constructor stub
			this.i = x;
			this.j = y;
		}
	}

	public static void main(String[] args) {

		// TODO Auto-generated method stub
		Scanner sc = new Scanner(System.in);
		int h = sc.nextInt();
		int w = sc.nextInt();
		int n = sc.nextInt();
		//

		initFactMatrices(h + w);

		Pair blocks[] = new Pair[n + 1];
		for (int i = 0; i < n; i++) {
			blocks[i] = new Pair(sc.nextInt() - 1, sc.nextInt() - 1);

		}
		blocks[n] = new Pair(h - 1, w - 1);

		Arrays.sort(blocks, new Comparator<Pair>() {
			@Override
			public int compare(Pair p1, Pair p2) {
				// TODO Auto-generated method stub
				return (p1.i + p1.j) - (p2.i + p2.j);
			}
		});

		long[] actualPathsFromStartTo = new long[n + 1];
		Pair start = new Pair(0, 0);
		for (int i = 0; i < actualPathsFromStartTo.length; i++) {
			actualPathsFromStartTo[i] = calculatePossiblePaths(start, blocks[i]);
			for (int j = 0; j < i; j++) {
				actualPathsFromStartTo[i] += (MODE-(actualPathsFromStartTo[j] * calculatePossiblePaths(blocks[j], blocks[i])%MODE));
				actualPathsFromStartTo[i] %=MODE;
			}

		}
		System.out.println(actualPathsFromStartTo[n]);
		sc.close();

	}

	private static long c(int n, int k) {
		return (((fact[n] *factInv[n - k] )%MODE)* factInv[k])%MODE;
	}


	static long MODE = 100_000_000_7;

	private static long calculatePossiblePaths(Pair from, Pair to) {
		if (from.i>to.i||from.j>to.j)return 0;
		return calculatePossiblePaths(from.i, from.j, to.i, to.j);
	}

	private static long calculatePossiblePaths(int from_i, int from_j, int to_i, int to_j) {

		int h = to_i - from_i + 1;
		int w = to_j - from_j + 1;
		////
		// NORMALIZE
		to_i = to_i - from_i;
		to_j = to_j - from_j;
		//
		from_i = from_j = 0;
		//////////////

		int downSteps = h - from_i - 1;
		int rightSteps = w - from_j - 1;

		//

		long res = c(downSteps + rightSteps, rightSteps);
		// TODO Auto-generated method stub
		return res;
	}

	static long fact[];
	static long factInv[];

	private static void initFactMatrices(int n) {
		fact = new long[n + 1];
		fact[0] = 1;
		for (int i = 1; i < fact.length; i++) {
			fact[i] = (i * fact[i - 1]) % MODE;
		}
		initInvFact(n);
	}

	private static void initInvFact(int n) {
		// TODO Auto-generated method stub
		factInv = new long[fact.length];
		for (int i = 0; i < factInv.length; i++) {
			factInv[i] = BigInteger.valueOf(fact[i]).modInverse(BigInteger.valueOf(MODE)).longValue();
		}
	}

}
