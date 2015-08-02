import java.util.ArrayList;
import java.util.Hashtable;
import java.util.Scanner;

public class B559 {

	static Hashtable<String, ArrayList<String>> cahce = new Hashtable<>();// unless this a time out was raising 

	public static boolean isEquavalent(String str1, String str2) {

		if (areEqualsFromCache(str1, str2))
			return true;
		//
		if (str1.length() != str2.length())
			return false;

		if (str1.length() % 2 == 1) {
			return str1.equals(str2); // was the missing
		}
		if ((str1.equals(str2)))
			return true;

		String a1 = str1.substring(0, str1.length() / 2);
		String a2 = str1.substring(str1.length() / 2);
		//
		String b1 = str2.substring(0, str2.length() / 2);
		String b2 = str2.substring(str2.length() / 2);
		if (isEquavalent(a1, b1) && isEquavalent(a2, b2)) {
			cache(str1, str2);
			return true;
		}
		if (isEquavalent(a1, b2) && isEquavalent(a2, b1)) {
			cache(str1, str2);
			return true;
		}

		return false;

	}

	// 0 =
	private static void cache(String str1, String str2) {
		// TODO Auto-generated method stub
		if (str1.compareTo(str2) > 0) {
			String tmp = str1;
			str1 = str2;
			str2 = tmp;

		}
		if (cahce.containsKey(str1)) {
			cahce.get(str1).add(str2);
		}
		else {
			ArrayList<String> arr=new ArrayList<>();
			arr.add(str2);
			cahce.put(str1, arr);
			
			
		}
	}

	private static boolean areEqualsFromCache(String str1, String str2) {
		if (str1.compareTo(str2) > 0) {
			String tmp = str1;
			str1 = str2;
			str2 = tmp;

		}
		if(!cahce.containsKey(str1))return false;
		return cahce.get(str1).contains(str2);
		// TODO Auto-generated method stub
	}

	public static void main(String[] args) {
		// TODO Auto-generated method stub
		Scanner sc = new Scanner(System.in);
		String str1 = sc.nextLine();
		String str2 = sc.nextLine();
		System.out.println(isEquavalent(str1, str2) ? "YES" : "NO");

		sc.close();
	}

}
