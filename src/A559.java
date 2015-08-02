import java.util.Scanner;

public class A559 {

	public static void main(String[] args) {
		// TODO Auto-generated method stub

		Scanner sc = new Scanner(System.in);
		int x[] = new int[6];
		x[0] = sc.nextInt();
		x[1] = sc.nextInt();
		x[2] = sc.nextInt();
		x[3] = sc.nextInt();
		x[4] = sc.nextInt();
		x[5] = sc.nextInt();
		int mode = 0;
		boolean leftIsDiversing = true;
		boolean rightIsDiversing = true;

		final int opening = 0, closing = 1, parallel = 2;
		// 0->opening 1->closing 2-> parallel
		int p1 = 1, p2 = 5;
		int count = 0;
		int rowCount = x[0];
		mode = 0;
		while (true) {
			switch (mode) {
			case opening:
				count += rowCount + rowCount + 1;
				x[p1]--;
				x[p2]--;
				rowCount++;
				break;
			case closing:
				count += rowCount + rowCount - 1;
				rowCount--;
				x[p1]--;
				x[p2]--;
				break;
			case parallel:
				count += rowCount + rowCount;
				x[p1]--;
				x[p2]--;
				break;
			}
			if (x[p1] == 0) {
				if (!leftIsDiversing && !rightIsDiversing)
					break;

				leftIsDiversing = !leftIsDiversing;
			}
			if (x[p2] == 0) {
				if (!leftIsDiversing && !rightIsDiversing)
					break;

				rightIsDiversing = !rightIsDiversing;

			}
			mode = leftIsDiversing && rightIsDiversing ? opening
					: (leftIsDiversing ^ rightIsDiversing ? parallel : closing);

			if (x[p1] == 0) {
				p1++;
			}
			if (x[p2] == 0) {
				p2--;
			}

			if (p1 == p2 && x[p1] == 0 && x[p2] == 0)
				break;
		}

		// series 1;
		// (x+(x+1)) .. (x+1)+(x+1) .. y times

		System.out.println(count);
		sc.close();

	}

}
